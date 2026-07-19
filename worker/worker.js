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

// Model aliases → concrete model IDs. When routing through SF LLM Gateway
// Express, the gateway exposes Claude Sonnet variants (no Opus, no Haiku, no
// Sonnet 5). We alias:
//   'opus'   → the newest available Sonnet — used for full deck generation
//   'sonnet' → an older Sonnet — used for cheap slide-scoped edits + suggestions
//   'haiku'  → the oldest Sonnet — reserved for anything explicitly cheap
// If a request eventually goes through Anthropic direct (BYOK sk-ant-*) and the
// modern IDs come back, the routing layer just passes them through.
const MODELS = {
  opus:   'claude-sonnet-4-5-20250929',
  sonnet: 'claude-sonnet-4-20250514',
  haiku:  'claude-3-5-sonnet-20240620-v1',
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
      // Show which auth path the Worker would take with no BYOK header.
      // Never prints the actual key values — just which env vars are set.
      const resolved = resolveProvider(null, env);
      return json({
        ok: true,
        ts: new Date().toISOString(),
        secrets: {
          LLM_GATEWAY_URL: !!env.LLM_GATEWAY_URL,
          LLM_GATEWAY_KEY: !!env.LLM_GATEWAY_KEY,
          ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY,
        },
        default_provider: resolved.provider,
        default_endpoint: resolved.endpoint || null,
      }, { request, env });
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
  const { userPrompt, tool } = buildTurnPrompt({ turn, questionId, slideId, userMessage, deckContext, questionSchema: body.questionSchema });

  // Route based on provider. LLM Gateway (SF's OpenAI-compat gateway) speaks
  // /chat/completions with a different shape. Anthropic direct speaks
  // /v1/messages with tool_use blocks.
  const { result, usage } = provider === 'llm-gateway'
    ? await callOpenAICompat({ endpoint, apiKey, modelId, systemBlocks, userPrompt, tool })
    : await callAnthropic({ endpoint, apiKey, modelId, systemBlocks, userPrompt, tool });

  return {
    ...result,
    _meta: { provider, model: modelId, usage },
  };
}

// ------------------------------------------------------------------ Anthropic /v1/messages
async function callAnthropic({ endpoint, apiKey, modelId, systemBlocks, userPrompt, tool }) {
  const payload = {
    model: modelId,
    max_tokens: 4096,
    system: systemBlocks,   // supports cache_control blocks
    messages: [{ role: 'user', content: userPrompt }],
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) throw upstreamError(res.status, raw);
  const data = safeParse(raw);
  if (!data) throw genericError('bad_upstream_json');
  const toolUse = (data.content || []).find(c => c.type === 'tool_use');
  if (!toolUse) throw Object.assign(genericError('no_tool_use'), { detail: data.content?.map(c => c.type).join(',') });
  return { result: toolUse.input, usage: data.usage };
}

// ------------------------------------------------------------------ OpenAI-compat /chat/completions
// SF LLM Gateway Express speaks the OpenAI Chat Completions API shape.
// - system content is a single message with role: "system" (no cache_control)
// - tools use type: "function" + function.parameters (not input_schema)
// - tool_choice is {type: "function", function: {name: "..."}}
// - the model's tool call comes back as choices[0].message.tool_calls[0].function.arguments,
//   a JSON-encoded STRING that we JSON.parse.
async function callOpenAICompat({ endpoint, apiKey, modelId, systemBlocks, userPrompt, tool }) {
  const systemText = flattenSystemBlocks(systemBlocks);
  const payload = {
    model: modelId,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user',   content: userPrompt },
    ],
    tools: [{
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }],
    tool_choice: { type: 'function', function: { name: tool.name } },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) throw upstreamError(res.status, raw);
  const data = safeParse(raw);
  if (!data) throw genericError('bad_upstream_json');

  const choice = data.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall) {
    throw Object.assign(genericError('no_tool_use'), {
      detail: choice?.message?.content?.slice?.(0, 300) || 'no tool_calls in response',
    });
  }
  const args = typeof toolCall.function?.arguments === 'string'
    ? safeParse(toolCall.function.arguments)
    : toolCall.function?.arguments;
  if (!args) throw genericError('bad_tool_arguments');
  return { result: args, usage: data.usage };
}

function flattenSystemBlocks(blocks) {
  // Anthropic system was an array of {type:'text', text, cache_control?}.
  // OpenAI wants a single string. Concatenate the text with dividers so the
  // model sees the same structure.
  return (blocks || []).map((b) => b?.text || '').filter(Boolean).join('\n\n');
}

function upstreamError(status, raw) {
  const err = new Error('upstream_error');
  err.code = `upstream_${status}`;
  err.status = status;
  err.detail = safeParse(raw) || raw.slice(0, 500);
  return err;
}
function genericError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
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
        endpoint: joinUrl(env.LLM_GATEWAY_URL, '/chat/completions'),
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
      endpoint: joinUrl(env.LLM_GATEWAY_URL, '/chat/completions'),
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
function buildTurnPrompt({ turn, questionId, slideId, userMessage, deckContext, questionSchema }) {
  // -------- Suggest turn: propose an answer to a single interview question --------
  if (turn === 'suggest') {
    const suggestSchema = {
      type: 'object',
      required: ['values', 'rationale'],
      properties: {
        values: {
          type: 'object',
          description: 'Field key → value map. For radio: one of the options (or a free-form string if none fit). For multiselect: an array of strings. For text/textarea: a string. For kpi-grid: array of {value, unit, label, framing}. For beachheads: array of {title, before, after, ttv}. Keys must match the field keys in the incoming questionSchema.',
          additionalProperties: true,
        },
        rationale: {
          type: 'string',
          description: 'One-sentence explanation of the suggestion, shown to the user in the chat.',
        },
      },
    };
    const tool = {
      name: 'suggest_answer',
      description: 'Propose a filled-in answer for the current interview question, based on the answers collected so far.',
      input_schema: suggestSchema,
    };
    const userPrompt = [
      `The user wants an AI-generated suggestion for interview question "${questionId}". Fill the fields below based on the answers collected so far and the deck rules in SKILL.md / STYLE-GUIDE.md.`,
      '',
      'Question schema (what fields to fill and their constraints):',
      '```json',
      JSON.stringify(questionSchema || {}, null, 2),
      '```',
      '',
      'Previous interview answers (deckContext):',
      '```json',
      JSON.stringify(deckContext || {}, null, 2),
      '```',
      '',
      'Rules:',
      '- If a field has fixed options, prefer one of those unless none fit — in which case return a concise free-form value that stays true to the intent.',
      '- Enforce every copy-length cap and voice rule from STYLE-GUIDE.md (no "but"/"however", parallel structure, ≤6-word titles, etc.).',
      '- For KPI grids: use whole integers, respect the Reduce/Improve framing, keep labels ≤10 words each.',
      '- For beachheads: bc-title ≤6 words, before/after ≤15 words each.',
      '- If prior answers are sparse, make reasonable industry-appropriate assumptions rather than returning empty values.',
      'Return the suggestion via the `suggest_answer` tool.',
    ].join('\n');
    return { userPrompt, tool };
  }

  // -------- Answer / Edit turns: return DOM patches --------
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
