// Interactive Customer Presentations — LLM proxy Worker
//
// Endpoints:
//   POST /decktools/llm      — main entrypoint. Interview turns and slide-edit turns.
//   POST /decktools/track    — fire-and-forget usage tracker pass-through
//   GET  /health             — liveness check
//
// Auth (Authorization: Bearer <key>):
//   sk-ant-…  → Anthropic direct
//   sk-…      → Salesforce LLM Gateway (requires LLM_GATEWAY_URL env)
//   (none)    → server-held key: ANTHROPIC_API_KEY or LLM_GATEWAY_KEY (whichever is set)
//
// The full sf-decktools skill (SKILL.md, STYLE-GUIDE.md, SLIDE-PRINCIPLES.md,
// sf-composer.html) is bundled at build time via Wrangler's Text module rule
// and sent as a single cache-marked system block. Prompt caching keeps the
// per-call cost low after the first call in a 5-minute window.

import SKILL_MD from '../skill-context/SKILL.md';
import STYLE_GUIDE_MD from '../skill-context/STYLE-GUIDE.md';
import SLIDE_PRINCIPLES_MD from '../skill-context/SLIDE-PRINCIPLES.md';
import COMPOSER_HTML from '../skill-context/sf-composer.html';

const MODELS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
};

const DEFAULT_MODEL = 'opus';

// ------------------------------------------------------------------ CORS
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allowed.length === 0 || allowed.includes(origin) || allowed.includes('*') ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, { status = 200, request, env } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(request ? corsHeaders(request, env || {}) : {}),
    },
  });
}

// ------------------------------------------------------------------ Router
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, ts: new Date().toISOString() }, { request, env });
    }

    if (url.pathname === '/decktools/llm' && request.method === 'POST') {
      try {
        const body = await request.json();
        const result = await handleLLM(body, request, env);
        return json(result, { request, env });
      } catch (err) {
        console.error('llm_error', err);
        return json(
          { error: err.message || 'internal', code: err.code || 'internal', detail: err.detail },
          { status: err.status || 500, request, env }
        );
      }
    }

    if (url.pathname === '/decktools/track' && request.method === 'POST') {
      // Fire-and-forget pass-through to the existing decktools tracker.
      try {
        const body = await request.text();
        ctx.waitUntil(
          fetch('https://decktools-tracker.mtoolin.workers.dev/track', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }).catch(() => {})
        );
      } catch (_) {}
      return json({ ok: true }, { request, env });
    }

    return json({ error: 'not_found' }, { status: 404, request, env });
  },
};

// ------------------------------------------------------------------ Core
async function handleLLM(body, request, env) {
  const {
    turn = 'answer',
    questionId,
    slideId,
    userMessage = '',
    deckContext = {},
    model = DEFAULT_MODEL,
  } = body;

  const authHeader = request.headers.get('Authorization') || '';
  const byokKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const { provider, endpoint, apiKey } = resolveProvider(byokKey, env);
  if (!apiKey) {
    const err = new Error('no_api_key');
    err.code = 'no_api_key';
    err.detail = 'No BYOK key supplied and no server-held key configured.';
    err.status = 401;
    throw err;
  }

  const modelId = MODELS[model] || MODELS[DEFAULT_MODEL];
  const systemBlocks = buildSystemBlocks();
  const { userPrompt, tool } = buildTurnPrompt({ turn, questionId, slideId, userMessage, deckContext });

  const payload = {
    model: modelId,
    max_tokens: 4096,
    system: systemBlocks,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  };

  const headers = provider === 'anthropic'
    ? {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      }
    : {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  if (!res.ok) {
    const err = new Error('upstream_error');
    err.code = `upstream_${res.status}`;
    err.status = res.status;
    err.detail = safeParse(raw) || raw.slice(0, 500);
    throw err;
  }

  const data = safeParse(raw);
  if (!data) {
    const err = new Error('bad_upstream_json');
    err.code = 'bad_upstream_json';
    throw err;
  }

  const toolUse = (data.content || []).find(c => c.type === 'tool_use');
  if (!toolUse) {
    const err = new Error('no_tool_use_in_response');
    err.code = 'no_tool_use';
    err.detail = data.content?.map(c => c.type).join(',');
    throw err;
  }

  return {
    ...toolUse.input,
    _meta: {
      provider,
      model: modelId,
      usage: data.usage,
    },
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ------------------------------------------------------------------ Provider resolution
function resolveProvider(byokKey, env) {
  if (byokKey) {
    if (/^sk-ant-/i.test(byokKey)) {
      return {
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1/messages',
        apiKey: byokKey,
      };
    }
    // Any other sk-… key → route through SF LLM Gateway
    if (env.LLM_GATEWAY_URL) {
      return {
        provider: 'llm-gateway',
        endpoint: joinUrl(env.LLM_GATEWAY_URL, '/v1/messages'),
        apiKey: byokKey,
      };
    }
    // No gateway configured → treat as an Anthropic key anyway (best-effort)
    return {
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      apiKey: byokKey,
    };
  }

  // No BYOK — use server-held credentials
  if (env.LLM_GATEWAY_URL && env.LLM_GATEWAY_KEY) {
    return {
      provider: 'llm-gateway',
      endpoint: joinUrl(env.LLM_GATEWAY_URL, '/v1/messages'),
      apiKey: env.LLM_GATEWAY_KEY,
    };
  }
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      apiKey: env.ANTHROPIC_API_KEY,
    };
  }
  return { provider: 'none', endpoint: '', apiKey: null };
}

function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
}

// ------------------------------------------------------------------ System prompt
//
// One big cache-marked block — SKILL.md + STYLE-GUIDE.md + SLIDE-PRINCIPLES.md
// + the sf-composer.html reference deck. This is the entire skill payload.
// Prompt caching means the model only "reads" this once per 5-minute window.
function buildSystemBlocks() {
  const preamble = [
    'You are the sf-decktools narrative deck builder.',
    'You have been loaded with the full Salesforce narrative deck design system below — the same skill Claude Code users get when they install sf-decktools.',
    'Follow every rule in SKILL.md, STYLE-GUIDE.md, and SLIDE-PRINCIPLES.md strictly. They are non-negotiable.',
    'Your job on each turn is to return a JSON tool call describing patches to apply to the deck HTML.',
    '',
    'Rules of engagement:',
    '- Preserve `sf-composer.html`\'s structural conventions exactly. Do not invent new class names, sections, or components.',
    '- Copy quality is the point. Enforce all copy-length caps and voice rules (no "but"/"however", parallel structure in Gap rows, ≤6-word bc-titles, etc.).',
    '- 80/20 color rule: 80% primary blues, 20% max accent. Never override primary blues.',
    '- 2D icons only in narrative pages.',
    '- Return only via the `apply_patches` tool. Never respond in prose.',
  ].join('\n');

  return [
    {
      type: 'text',
      text: preamble,
    },
    {
      type: 'text',
      text: '---\n## SKILL.md — workflow + rules\n\n' + SKILL_MD,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: '---\n## STYLE-GUIDE.md — voice, copy, brand\n\n' + STYLE_GUIDE_MD,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: '---\n## SLIDE-PRINCIPLES.md — per-slide design rules\n\n' + SLIDE_PRINCIPLES_MD,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: '---\n## sf-composer.html — canonical reference deck (mirror this structure)\n\n```html\n' + COMPOSER_HTML + '\n```',
      cache_control: { type: 'ephemeral' },
    },
  ];
}

// ------------------------------------------------------------------ Turn prompts
//
// Two turn shapes:
//   turn = 'answer' — user just answered an interview question. Update whatever
//                     slides that answer maps to per the Canvas Build Guide in SKILL.md.
//   turn = 'edit'   — user is editing a specific slide with a free-form request.
//                     Apply the edit, preserving all brand rules.
function buildTurnPrompt({ turn, questionId, slideId, userMessage, deckContext }) {
  const patchSchema = {
    type: 'object',
    required: ['patches', 'message'],
    properties: {
      message: {
        type: 'string',
        description: 'One-sentence human-readable summary of what changed. Shown in the chat UI.',
      },
      next_question: {
        type: ['string', 'null'],
        description: 'For interview turns: the next question to ask (or null if the interview is complete). Ignore for edit turns.',
      },
      patches: {
        type: 'array',
        description: 'Ordered list of DOM patches to apply to the in-memory deck document.',
        items: {
          type: 'object',
          required: ['slide_id', 'selector', 'new_html'],
          properties: {
            slide_id: {
              type: 'string',
              description: 'The `data-section` value of the target slide (e.g. "hero", "why-now", "gap", "stack", "beachheads", "scale", "proof", "roadmap", "closing", "attribution"). Use "meta" for changes that live outside a slide (e.g. accent CSS variable, <html> attributes).',
            },
            selector: {
              type: 'string',
              description: 'CSS selector inside the slide (scoped to that slide). For "meta" patches, a global selector such as ":root" or "html".',
            },
            new_html: {
              type: 'string',
              description: 'The replacement outerHTML for the matched element. Must be valid HTML that fits inside its parent.',
            },
            op: {
              type: 'string',
              enum: ['replace', 'set-attribute', 'set-style'],
              description: 'Default is "replace". Use "set-attribute" or "set-style" when only a single attribute/style is being changed (then `new_html` is the value, and `selector` may include a `::attr(name)` or `::style(prop)` suffix).',
            },
          },
        },
      },
    },
  };

  const tool = {
    name: 'apply_patches',
    description: 'Apply patches to the deck DOM and optionally advance the interview.',
    input_schema: patchSchema,
  };

  const contextBlock = [
    'Current deck context (interview answers collected so far + current slot values):',
    '```json',
    JSON.stringify(deckContext || {}, null, 2),
    '```',
  ].join('\n');

  let userPrompt;
  if (turn === 'edit') {
    userPrompt = [
      `The user is editing slide "${slideId || 'unknown'}".`,
      `Their instruction: ${JSON.stringify(userMessage)}`,
      '',
      contextBlock,
      '',
      'Apply the edit as one or more patches. Preserve every rule in SLIDE-PRINCIPLES.md for this slide. Do not touch other slides unless the instruction explicitly requires it.',
    ].join('\n');
  } else {
    userPrompt = [
      `Interview turn. The user just answered question "${questionId || 'unknown'}".`,
      `Their answer: ${JSON.stringify(userMessage)}`,
      '',
      contextBlock,
      '',
      'Update the slide(s) that this answer maps to, per the Canvas Build Guide in SKILL.md. Return patches for every affected slide. Then set `next_question` to the id of the next interview question, or null if this was the last one.',
    ].join('\n');
  }

  return { userPrompt, tool };
}
