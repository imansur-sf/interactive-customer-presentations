// ============================================================
// server.js — Express server for Interactive Customer Presentations
// Heroku Private Space with Gemini AI backend
// ============================================================
// Set GEMINI_API_KEY as a Heroku config var.
// ============================================================

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// Configuration
// ============================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MAX_SCRAPE_BYTES = 3_000_000;
const SCRAPE_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; interactive-customer-presentations/1.0)';

// Image generation
const IMAGE_GEN_MODEL = 'gemini-3.1-flash-image';
const IMAGE_GEN_TIMEOUT_MS = 30_000;
const MAX_IMAGE_GEN_BATCH = 12;

// Gemini model mapping by tier
// IMPORTANT: Verify these models are available for your key before deploying.
// List models: curl "https://generativelanguage.googleapis.com/v1beta/models?key=$KEY"
const TIER_MODELS = {
  fast: 'gemini-3.5-flash-lite',
  balanced: 'gemini-3.5-flash',
  powerful: 'gemini-3.1-pro-preview'
};
const DEFAULT_MODEL = TIER_MODELS.balanced;

// Rate limiting — in-memory per-IP
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateBuckets = new Map();

// Tracker upstream
const TRACKER_URL = 'https://decktools-tracker.mtoolin.workers.dev/track';

// ============================================================
// Middleware
// ============================================================
app.use(express.json({ limit: '1mb' }));

// CORS for API routes (same-origin won't need it, but useful for dev)
app.use('/api', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============================================================
// API Routes
// ============================================================

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'interactive-customer-presentations',
    version: 1,
    endpoints: [
      'GET /api/scrape',
      'POST /api/llm',
      'POST /api/generate-images',
      'POST /api/track',
      'GET /api/health'
    ],
    llm_configured: Boolean(GEMINI_API_KEY)
  });
});

// Temporary debug endpoint — remove after testing
app.get('/api/debug-gemini', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say hello in one word' }] }] })
    });
    const body = await r.text();
    res.json({ status: r.status, keyPrefix: key?.slice(0, 8), model, body: body.slice(0, 1000) });
  } catch (e) {
    res.json({ error: e.message, keyPrefix: key?.slice(0, 8) });
  }
});

// --- Tracker Endpoint (replaces Cloudflare Worker /imranAI/track) ---
app.post('/api/track', async (req, res) => {
  try {
    const body = JSON.stringify(req.body);
    fetch(TRACKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {});
  } catch (_) {}
  res.json({ ok: true });
});

// --- Scrape Endpoint ---
app.get('/api/scrape', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'missing_url' });

  let targetURL;
  try { targetURL = new URL(target); }
  catch { return res.status(400).json({ error: 'invalid_url' }); }

  if (targetURL.protocol !== 'https:' && targetURL.protocol !== 'http:') {
    return res.status(400).json({ error: 'bad_protocol', got: targetURL.protocol });
  }
  if (isDangerousHost(targetURL.hostname)) {
    return res.status(403).json({ error: 'blocked_host', hostname: targetURL.hostname });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

    const upstream = await fetch(targetURL.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(502).json({ error: 'upstream_status', status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    if (!/^text\//i.test(contentType) && !/(json|xml|xhtml)/i.test(contentType)) {
      return res.status(415).json({ error: 'not_text', contentType });
    }

    const reader = upstream.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_SCRAPE_BYTES) {
        try { reader.cancel(); } catch (_) {}
        return res.status(413).json({ error: 'too_large', limitBytes: MAX_SCRAPE_BYTES });
      }
      chunks.push(value);
    }

    const body = Buffer.concat(chunks);
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=600',
      'X-Scraper-Source': targetURL.hostname,
      'X-Scraper-Bytes': String(total)
    });
    res.send(body);
  } catch (err) {
    const code = err && err.name === 'AbortError' ? 'timeout' : 'network_error';
    res.status(502).json({ error: code, message: (err && err.message) || 'unknown' });
  }
});

// --- LLM Endpoint (Gemini API with tool-calling support) ---
app.post('/api/llm', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'llm_not_configured',
      hint: 'Set GEMINI_API_KEY config var on this Heroku app'
    });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return res.status(429).json({ error: 'rate_limited', retryAfterMs: rl.retryAfterMs });
  }

  const { prompt, system, tier, maxTokens, tools, toolChoice } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'missing_prompt' });
  }
  if (prompt.length > 500_000) {
    return res.status(413).json({ error: 'prompt_too_long' });
  }

  const chosenTier = ['fast', 'balanced', 'powerful'].includes(tier) ? tier : 'balanced';
  const model = TIER_MODELS[chosenTier] || DEFAULT_MODEL;
  const tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 8192, 100), 65536);

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const geminiBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: tokens }
  };

  // System instruction
  if (system && typeof system === 'string' && system.trim()) {
    geminiBody.systemInstruction = { parts: [{ text: system }] };
  }

  // Tool calling support — translate from client format to Gemini format
  const hasTools = Array.isArray(tools) && tools.length > 0;
  if (hasTools) {
    geminiBody.tools = [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || {}
      }))
    }];

    // If a specific tool is requested, force the model to use it
    if (toolChoice && typeof toolChoice === 'string') {
      geminiBody.toolConfig = {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [toolChoice]
        }
      };
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const upstream = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (upstream.status === 400) {
      const body = await upstream.text().catch(() => '');
      return res.status(502).json({ error: 'gemini_bad_request', body: body.slice(0, 500) });
    }
    if (upstream.status === 401 || upstream.status === 403) {
      return res.status(502).json({ error: 'gemini_auth_failed' });
    }
    if (upstream.status === 429) {
      return res.status(429).json({ error: 'gemini_rate_limited' });
    }
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      return res.status(502).json({ error: 'gemini_failed', status: upstream.status, body: body.slice(0, 500) });
    }

    const data = await upstream.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const usage = data.usageMetadata || null;

    // Check for function call response (tool calling mode)
    if (hasTools) {
      const fnCallPart = parts.find(p => p.functionCall);
      if (fnCallPart) {
        return res.json({
          result: fnCallPart.functionCall.args || {},
          functionName: fnCallPart.functionCall.name,
          model_used: model,
          tier: chosenTier,
          usage
        });
      }

      // Fallback: model returned text instead of a function call.
      // Try to parse the text as JSON (some models do this).
      const textContent = parts
        .filter(p => p.text)
        .map(p => p.text)
        .join('');

      if (textContent) {
        // Try to extract JSON from the text response
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            return res.json({
              result: parsed,
              functionName: toolChoice || 'unknown',
              model_used: model,
              tier: chosenTier,
              usage,
              _fallback: 'text_to_json'
            });
          } catch (_) {}
        }
      }

      return res.status(502).json({
        error: 'no_function_call',
        hint: 'Model did not return a function call. Try a different tier or simplify the prompt.',
        text_preview: (textContent || '').slice(0, 300)
      });
    }

    // Plain text generation mode (no tools)
    const text = parts
      .filter(p => p.text)
      .map(p => p.text)
      .join('') || '';

    if (!text) {
      return res.status(502).json({ error: 'gemini_empty_response' });
    }

    res.json({
      text,
      model_used: model,
      tier: chosenTier,
      usage
    });
  } catch (err) {
    const code = err && err.name === 'AbortError' ? 'timeout' : 'network_error';
    res.status(502).json({ error: code, message: (err && err.message) || 'unknown' });
  }
});

// --- Batch Image Generation (Gemini) ---
app.post('/api/generate-images', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'llm_not_configured', hint: 'Set GEMINI_API_KEY' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const rl = checkRateLimit(ip);
  if (!rl.ok) return res.status(429).json({ error: 'rate_limited', retryAfterMs: rl.retryAfterMs });

  const { prompts } = req.body;
  if (!Array.isArray(prompts) || prompts.length === 0 || prompts.length > MAX_IMAGE_GEN_BATCH) {
    return res.status(400).json({ error: 'invalid_prompts', max: MAX_IMAGE_GEN_BATCH });
  }

  for (const p of prompts) {
    if (!p || !p.slot || !p.prompt || typeof p.prompt !== 'string' || p.prompt.length > 2000) {
      return res.status(400).json({ error: 'invalid_prompt_entry', slot: p?.slot });
    }
  }

  const results = await Promise.allSettled(
    prompts.map(async (p) => {
      const result = await generateImage(p.prompt);
      return { slot: p.slot, ...result };
    })
  );

  const output = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { slot: prompts[i].slot, error: r.reason?.message || 'generation_failed' };
  });

  res.json({ results: output });
});

// Shared image generation helper
async function generateImage(prompt) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const geminiBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS);

  const upstream = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiBody),
    signal: controller.signal
  });
  clearTimeout(timeout);

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    throw new Error(`Gemini ${upstream.status}: ${body.slice(0, 200)}`);
  }

  const data = await upstream.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData);

  if (!imagePart) {
    throw new Error('No image in Gemini response');
  }

  const mime = imagePart.inlineData.mimeType || 'image/jpeg';
  const imageData = `data:${mime};base64,${imagePart.inlineData.data}`;

  return { imageData };
}

// ============================================================
// Static file serving (AFTER API routes)
// ============================================================
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  maxAge: '1h'
}));

// Fallback to index.html for SPA-style routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// Start server — MUST use '::' for Heroku Fir Private Spaces (IPv6)
// ============================================================
app.listen(PORT, '::', () => {
  console.log(`interactive-customer-presentations running on port ${PORT} (IPv6 dual-stack)`);
  console.log(`LLM backend: ${GEMINI_API_KEY ? 'Gemini API configured' : 'NOT configured (set GEMINI_API_KEY)'}`);
});

// ============================================================
// Utilities
// ============================================================
function isDangerousHost(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  if (h === 'localhost' || h === 'localhost.localdomain') return true;
  if (h === 'metadata.google.internal') return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === '169.254.169.254') return true;
  if (/^(10|127)\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (h === '0.0.0.0') return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc00:') || h.startsWith('fd00:')) return true;
  return false;
}

function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (v.resetAt < now) rateBuckets.delete(k);
  }
  if (bucket.count > RATE_LIMIT_MAX) {
    return { ok: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
  }
  return { ok: true };
}
