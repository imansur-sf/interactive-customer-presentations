// LLM plumbing — single-provider dispatcher (mirrors UPG's apiclient.js).
//
// The one supported path is the Cloudflare Worker fronting the SF LLM Gateway
// (OpenAI-compatible Claude, sonnet-4-5) with optional BYOK:
//   • no key, or a non-Anthropic key → Worker uses its server-held SF Gateway key,
//     or the supplied key as a Bearer token against the Gateway.
//   • key starting with 'sk-ant-…'   → Worker uses the key directly against Anthropic.

export const DEFAULT_LEGACY_WORKER_URL = 'https://icp-imranai-llm.imansur.workers.dev';
// Back-compat alias for older imports.
export const DEFAULT_WORKER_URL = DEFAULT_LEGACY_WORKER_URL;
export const SF_GATEWAY_URL = 'https://eng-ai-model-gateway.sfproxy.devx-preprod.aws-esvc1-useast2.aws.sfdc.cl/v1/chat/completions';

const LS = {
  legacyWorkerUrl: 'icp.legacyWorkerUrl',
  // Namespaced BYOK key — kept distinct from any older 'icp.apiKey' so a reset
  // in Settings actually clears the effective key rather than shadowing it.
  byokKey: 'icp.byokKey',
  // Legacy keys still read for graceful migration.
  legacyWorkerUrlOld: 'icp.workerUrl',
  legacyApiKeyOld: 'icp.apiKey',
};

// Legacy-worker model aliases (Anthropic / SF Gateway path).
const MODELS = {
  opus:   'claude-sonnet-4-5-20250929',
  sonnet: 'claude-sonnet-4-20250514',
  haiku:  'claude-3-5-sonnet-20240620-v1',
};

// -------------------- Public API --------------------
export function getLegacyWorkerUrl() {
  return (
    localStorage.getItem(LS.legacyWorkerUrl) ||
    localStorage.getItem(LS.legacyWorkerUrlOld) ||
    DEFAULT_LEGACY_WORKER_URL
  ).trim();
}
// Back-compat for older imports in app.js.
export function getWorkerUrl() { return getLegacyWorkerUrl(); }

export function getApiKey() {
  return (
    localStorage.getItem(LS.byokKey) ||
    localStorage.getItem(LS.legacyApiKeyOld) ||
    ''
  ).trim();
}

/**
 * Detect which upstream path this call should use, based on the key present.
 * Exposed for the UI (Settings modal + status indicators).
 *
 * Returns one of:
 *   'legacy-anthropic-byok'  — sk-ant-… key, use Worker w/ Anthropic direct
 *   'legacy-gateway-byok'    — empty or other key, use Worker w/ SF Gateway
 */
export function detectRoute() {
  const key = getApiKey();
  if (/^sk-ant-/i.test(key)) return 'legacy-anthropic-byok';
  return 'legacy-gateway-byok';
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
 * The unified LLM call. Sends the payload to the Cloudflare Worker, which
 * builds the system prompt server-side and dispatches to Anthropic or the
 * SF LLM Gateway depending on the BYOK key supplied.
 */
export async function callLLM(payload) {
  return callWorker(payload);
}

// -------------------- Legacy Worker path (BYOK Anthropic / SF Gateway) --------------------
export async function callWorker(payload) {
  const workerUrl = getLegacyWorkerUrl();
  const key = getApiKey();
  const headers = { 'content-type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  const url = joinUrl(workerUrl, '/imranAI/llm');

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
