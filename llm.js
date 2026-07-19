// LLM plumbing — hybrid dispatcher.
//
// Route resolution (based on the key the user has in Settings):
//   • empty                    → Cloudflare Worker (uses server-held key)
//   • starts with 'sk-ant-…'   → Cloudflare Worker with BYOK Anthropic
//   • any other non-empty key  → browser-direct to SF LLM Gateway Express
//
// The SF gateway hostname is Salesforce-internal — only reachable from SF
// network (VPN or SF-managed devices). Cloudflare can't proxy it, so any
// user with an SF gateway key must be on VPN.

export const DEFAULT_WORKER_URL = 'https://icp-decktools-llm.imansur.workers.dev';
export const SF_GATEWAY_URL = 'https://eng-ai-model-gateway.sfproxy.devx-preprod.aws-esvc1-useast2.aws.sfdc.cl/chat/completions';

const LS = {
  workerUrl: 'icp.workerUrl',
  apiKey: 'icp.apiKey',
};

// Model aliases. Direct calls to SF gateway can only use the Sonnet IDs the
// gateway exposes. Worker+Anthropic accepts these IDs but they also work if
// swapped for newer Anthropic-native IDs later.
const MODELS = {
  opus:   'claude-sonnet-4-5-20250929',
  sonnet: 'claude-sonnet-4-20250514',
  haiku:  'claude-3-5-sonnet-20240620-v1',
};

// -------------------- Public API --------------------
export function getWorkerUrl() {
  return (localStorage.getItem(LS.workerUrl) || DEFAULT_WORKER_URL).trim();
}
export function getApiKey() {
  return (localStorage.getItem(LS.apiKey) || '').trim();
}

/**
 * Detect which upstream path this call should use, based on the key present.
 * Exposed for the UI (Settings modal + status indicators).
 */
export function detectRoute() {
  const key = getApiKey();
  if (!key) return 'worker-default';
  if (/^sk-ant-/i.test(key)) return 'worker-anthropic-byok';
  return 'gateway-direct';
}

/** Convenience wrapper for the Suggest button */
export async function suggestAnswer({ questionId, deckContext, questionSchema }) {
  return callLLM({
    turn: 'suggest',
    questionId,
    userMessage: 'Generate a suggested answer for this question.',
    deckContext,
    questionSchema,
    model: 'sonnet',
  });
}

/**
 * The unified LLM call. Dispatches to the direct-to-gateway path or the
 * Worker path based on what's in Settings. Both paths return the same
 * shape ({ patches, message, ... } or { values, rationale } depending on
 * the turn type).
 */
export async function callLLM(payload) {
  const route = detectRoute();
  if (route === 'gateway-direct') return callGatewayDirect(payload);
  return callWorker(payload);
}

// Kept for backward compat with older imports in app.js.
export const callWorker_ = callWorker;

// -------------------- Direct-to-gateway path --------------------
async function callGatewayDirect({ turn, questionId, slideId, userMessage, deckContext, questionSchema, model = 'opus' }) {
  const apiKey = getApiKey();
  if (!apiKey) throwUser('no_api_key', 'No SF LLM Gateway key set. Open Settings and paste your key.');

  const systemPrompt = await loadSystemPrompt();
  const { userPrompt, tool } = buildTurnPrompt({ turn, questionId, slideId, userMessage, deckContext, questionSchema });
  const modelId = MODELS[model] || MODELS.opus;

  const body = {
    model: modelId,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
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

  let res;
  try {
    res = await fetch(SF_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network-level failures (CORS, DNS, VPN not connected) surface here.
    const msg = err.message || String(err);
    if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
      throwUser('gateway_unreachable',
        "Can't reach the SF LLM Gateway from this browser. Confirm you're on Salesforce VPN, or that this app's origin is CORS-allowed by the gateway.");
    }
    throwUser('gateway_network_error', msg);
  }

  const text = await res.text();
  if (!res.ok) {
    const body = safeParse(text);
    const detail = body?.error?.message || text.slice(0, 300);
    throwUser(`gateway_${res.status}`, `Gateway returned ${res.status}: ${detail}`, { status: res.status });
  }

  const data = safeParse(text);
  if (!data) throwUser('gateway_bad_json', 'Gateway returned invalid JSON.');
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    const contentPreview = data.choices?.[0]?.message?.content?.slice?.(0, 300) || '(no content)';
    throwUser('gateway_no_tool_call', `Gateway didn't invoke the required tool. Response preview: ${contentPreview}`);
  }
  const args = typeof toolCall.function?.arguments === 'string'
    ? safeParse(toolCall.function.arguments)
    : toolCall.function?.arguments;
  if (!args) throwUser('gateway_bad_tool_arguments', 'Gateway returned unparseable tool arguments.');
  return { ...args, _meta: { route: 'gateway-direct', model: modelId, usage: data.usage } };
}

// System prompt is 100KB+ — fetch once per page load, cache in memory.
let cachedSystemPrompt = null;
async function loadSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const [skill, style, principles, composer] = await Promise.all([
    fetch('skill-context/SKILL.md').then(r => r.text()),
    fetch('skill-context/STYLE-GUIDE.md').then(r => r.text()),
    fetch('skill-context/SLIDE-PRINCIPLES.md').then(r => r.text()),
    fetch('skill-context/sf-composer.html').then(r => r.text()),
  ]);
  cachedSystemPrompt = [
    "You are the sf-decktools narrative deck builder.",
    "You have been loaded with the full Salesforce narrative deck design system below — the same skill Claude Code users get when they install sf-decktools.",
    "Follow every rule in SKILL.md, STYLE-GUIDE.md, and SLIDE-PRINCIPLES.md strictly. They are non-negotiable.",
    "On each turn, respond ONLY via the requested tool function — never in prose.",
    "Preserve sf-composer.html's structural conventions exactly. Do not invent new class names, sections, or components.",
    "Copy quality is the point. Enforce every copy-length cap and voice rule (no 'but'/'however', parallel structure in Gap rows, ≤6-word bc-titles, etc.).",
    "80/20 color rule: 80% primary blues, 20% max accent. 2D icons only in narrative pages.",
    "",
    "---",
    "## SKILL.md — workflow + rules",
    "",
    skill,
    "",
    "---",
    "## STYLE-GUIDE.md — voice, copy, brand",
    "",
    style,
    "",
    "---",
    "## SLIDE-PRINCIPLES.md — per-slide design rules",
    "",
    principles,
    "",
    "---",
    "## sf-composer.html — canonical reference deck (mirror this structure)",
    "",
    "```html",
    composer,
    "```",
  ].join('\n');
  return cachedSystemPrompt;
}

// -------------------- Prompt building (mirror of worker.js) --------------------
function buildTurnPrompt({ turn, questionId, slideId, userMessage, deckContext, questionSchema }) {
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
          description: 'One-sentence explanation of the suggestion, shown to the user.',
        },
      },
    };
    const tool = {
      name: 'suggest_answer',
      description: 'Propose a filled-in answer for the current interview question, based on the answers collected so far.',
      input_schema: suggestSchema,
    };
    const userPrompt = [
      `The user wants an AI-generated suggestion for interview question "${questionId}". Fill the fields below based on the answers collected so far and the deck rules.`,
      '',
      'Question schema:',
      '```json',
      JSON.stringify(questionSchema || {}, null, 2),
      '```',
      '',
      'Previous answers (deckContext):',
      '```json',
      JSON.stringify(deckContext || {}, null, 2),
      '```',
      '',
      'Rules:',
      "- If a field has fixed options, prefer one of those unless none fit — then return a concise free-form value that stays true to intent.",
      '- Enforce every copy-length cap and voice rule from STYLE-GUIDE.md (no "but"/"however", parallel structure, ≤6-word titles).',
      '- For KPI grids: whole integers, respect Reduce/Improve framing, labels ≤10 words.',
      '- For beachheads: bc-title ≤6 words, before/after ≤15 words each.',
      '- If prior answers are sparse, make reasonable industry-appropriate assumptions rather than returning empty values.',
      'Return via the `suggest_answer` tool.',
    ].join('\n');
    return { userPrompt, tool };
  }

  // Answer / Edit / Generate turns — return DOM patches
  const patchSchema = {
    type: 'object',
    required: ['patches', 'message'],
    properties: {
      message: { type: 'string', description: 'One-sentence human-readable summary of what changed.' },
      next_question: { type: ['string', 'null'], description: 'For interview turns: the next question id, or null when done.' },
      patches: {
        type: 'array',
        description: 'Ordered list of DOM patches to apply to the in-memory deck document.',
        items: {
          type: 'object',
          required: ['slide_id', 'selector', 'new_html'],
          properties: {
            slide_id: { type: 'string', description: 'The slide id — "hero", "why-now", "gap", "stack", "ai-in-action", "real-time", "beachheads", "scale", "proof", "roadmap", "closing", "attribution", or "meta" for changes outside a slide (e.g. accent CSS variable).' },
            selector: { type: 'string', description: 'CSS selector inside the slide. For "meta", a global selector such as ":root" or "html".' },
            new_html: { type: 'string', description: 'The replacement outerHTML for the matched element.' },
            op: { type: 'string', enum: ['replace', 'set-attribute', 'set-style'], description: 'Default is "replace".' },
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
    'Current deck context (interview answers collected so far):',
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
  } else if (turn === 'generate') {
    userPrompt = [
      'Full-deck generation turn. The user has completed the interview. Generate patches that transform the reference deck (sf-composer.html) into the customer\'s deck using the answers in deckContext.',
      'Emit patches slide-by-slide following the Canvas Build Guide in SKILL.md. Update the hero H1, hero KPIs, Why Now cards, Gap rows, Stack layers, Beachhead cards, Scale cards, Proof block, Roadmap phases, and Closing CTA. Also set the accent CSS variable on the :root selector as a "meta" patch.',
      '',
      contextBlock,
    ].join('\n');
  } else {
    userPrompt = [
      `Interview turn. The user just answered question "${questionId || 'unknown'}".`,
      `Their answer: ${JSON.stringify(userMessage)}`,
      '',
      contextBlock,
      '',
      'Update the slide(s) this answer maps to, per the Canvas Build Guide in SKILL.md. Return patches for every affected slide.',
    ].join('\n');
  }

  return { userPrompt, tool };
}

// -------------------- Worker path (unchanged) --------------------
export async function callWorker(payload) {
  const workerUrl = getWorkerUrl();
  const key = getApiKey();
  const headers = { 'content-type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  const url = joinUrl(workerUrl, '/decktools/llm');

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (err) {
    throwUser('worker_unreachable', `Cloudflare Worker not reachable: ${err.message}`);
  }

  const text = await res.text();
  const body = safeParse(text) || { error: 'bad_json', raw: text.slice(0, 400) };
  if (!res.ok) throwUser(body.code || `worker_${res.status}`, renderErrorMessage(res.status, body), { status: res.status, detail: body.detail });
  return body;
}

function renderErrorMessage(status, body) {
  const code = body && body.code;
  if (code === 'no_api_key') return 'The Worker has no server-held key configured, and no BYOK key was supplied. Set an API key in Settings.';
  if (status === 401) return 'Auth failed. Double-check your API key in Settings.';
  if (status === 429) return 'Rate limited by the LLM provider. Wait a moment and try again.';
  if (status === 503) return 'The LLM upstream failed. Try again in a moment.';
  if (status >= 500) return `Worker returned ${status}. ${body.detail ? '(' + JSON.stringify(body.detail).slice(0, 200) + ')' : ''}`;
  return body.error || `Request failed (${status}).`;
}

// -------------------- Patch application (unchanged) --------------------
export function applyPatches(deckDoc, patches) {
  const applied = [];
  const skipped = [];
  for (const p of patches || []) {
    try {
      const scope = p.slide_id === 'meta'
        ? deckDoc
        : deckDoc.querySelector(`.slide[data-section="${cssEscape(sectionForSlideId(deckDoc, p.slide_id))}"]`) || deckDoc.getElementById(p.slide_id);
      if (!scope) { skipped.push({ patch: p, reason: 'slide_not_found' }); continue; }
      const target = scope.querySelector(p.selector) || (scope.matches?.(p.selector) ? scope : null);
      if (!target) { skipped.push({ patch: p, reason: 'selector_no_match' }); continue; }

      const op = p.op || 'replace';
      if (op === 'replace') {
        const tpl = deckDoc.createElement('template');
        tpl.innerHTML = String(p.new_html || '');
        const frag = tpl.content;
        if (frag.childNodes.length === 1 && frag.firstChild.nodeType === 1) {
          target.replaceWith(frag.firstChild);
        } else {
          const parent = target.parentNode;
          parent.insertBefore(frag, target);
          target.remove();
        }
      } else if (op === 'set-attribute') {
        const m = /::attr\(([^)]+)\)$/.exec(p.selector);
        if (!m) { skipped.push({ patch: p, reason: 'attr_op_missing_suffix' }); continue; }
        target.setAttribute(m[1], p.new_html);
      } else if (op === 'set-style') {
        const m = /::style\(([^)]+)\)$/.exec(p.selector);
        if (!m) { skipped.push({ patch: p, reason: 'style_op_missing_suffix' }); continue; }
        target.style.setProperty(m[1], p.new_html);
      } else {
        skipped.push({ patch: p, reason: `unknown_op:${op}` });
        continue;
      }
      applied.push(p);
    } catch (e) {
      skipped.push({ patch: p, reason: e.message });
    }
  }
  return { applied, skipped };
}

function sectionForSlideId(deckDoc, slideId) {
  const map = {
    'hero':        '',
    'why-now':     'Why Now',
    'gap':         'The Gap',
    'stack':       'How It Works',
    'ai-in-action':'AI in Action',
    'real-time':   'Real-Time Data',
    'beachheads':  'Start Here',
    'scale':       'Where This Goes',
    'proof':       'What It Does Today',
    'roadmap':     'The Path Forward',
    'closing':     'Next Steps',
    'attribution': '',
  };
  return map[slideId] ?? slideId;
}

// -------------------- helpers --------------------
function throwUser(code, userMessage, extra) {
  const err = new Error(code);
  err.code = code;
  err.userMessage = userMessage;
  Object.assign(err, extra || {});
  throw err;
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function joinUrl(base, path) { return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path); }
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}
