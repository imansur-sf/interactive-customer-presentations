// LLM plumbing — call the Cloudflare Worker, apply returned patches to the
// in-memory deck document.
//
// Worker turn shapes:
//   { turn: "generate", deckContext }              → full deck generation
//   { turn: "edit",     slideId, userMessage, deckContext } → scoped edit

// Default Worker URL — the deployed proxy that already has a server-held key.
// Users can override this in Settings (e.g. to point at a fork or use their
// own key), but the app works out of the box for anyone visiting the page.
export const DEFAULT_WORKER_URL = 'https://icp-decktools-llm.imansur.workers.dev';

const LS = {
  workerUrl: 'icp.workerUrl',
  apiKey: 'icp.apiKey',
};

export function getWorkerUrl() {
  return (localStorage.getItem(LS.workerUrl) || DEFAULT_WORKER_URL).trim();
}
export function getApiKey() {
  return (localStorage.getItem(LS.apiKey) || '').trim();
}

/**
 * Ask the Worker to generate a suggested answer for an interview question.
 * Returns { values, rationale } — the client applies `values` to the fields.
 */
export async function suggestAnswer({ questionId, deckContext, questionSchema }) {
  return callWorker({
    turn: 'suggest',
    questionId,
    userMessage: 'Generate a suggested answer for this question.',
    deckContext,
    questionSchema,
    model: 'sonnet', // cheaper for one-off suggestions
  });
}

/**
 * Call the Worker. Throws on network/HTTP error; returns the parsed JSON body
 * ({ patches, message, next_question?, _meta }) on success.
 */
export async function callWorker(payload) {
  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    const err = new Error('no_worker_url');
    err.userMessage = 'No Worker URL configured. Open Settings and paste your deployed Cloudflare Worker URL.';
    throw err;
  }
  const key = getApiKey();

  const url = joinUrl(workerUrl, '/decktools/llm');
  const headers = { 'content-type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: 'bad_json', raw: text.slice(0, 500) }; }

  if (!res.ok) {
    const err = new Error(body.error || `http_${res.status}`);
    err.status = res.status;
    err.userMessage = renderErrorMessage(res.status, body);
    err.detail = body.detail;
    throw err;
  }
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

function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
}

/**
 * Apply an ordered list of patches to the in-memory deckDoc.
 *
 * Patch shape:
 *   { slide_id: string, selector: string, new_html: string, op?: 'replace' | 'set-attribute' | 'set-style' }
 *
 * `slide_id === 'meta'` targets nodes outside any slide (e.g. `:root` for
 * accent CSS variables, `html` for data-* attributes).
 *
 * Returns { applied, skipped } — the caller decides how to surface skipped
 * patches (usually a note in the chat log).
 */
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
        // Parse `new_html` as a fragment and replace the target with it.
        const tpl = deckDoc.createElement('template');
        tpl.innerHTML = String(p.new_html || '');
        const frag = tpl.content;
        // If the fragment has exactly one element, swap it in outerHTML-style.
        if (frag.childNodes.length === 1 && frag.firstChild.nodeType === 1) {
          target.replaceWith(frag.firstChild);
        } else {
          // Multi-node or text-only replacement — replace with fragment.
          const parent = target.parentNode;
          parent.insertBefore(frag, target);
          target.remove();
        }
      } else if (op === 'set-attribute') {
        // selector must include `::attr(name)` suffix — parsed out here.
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

// Look up the composer's data-section string from a canonical slide id.
// Falls back to the id itself so `slide-4` also works.
function sectionForSlideId(deckDoc, slideId) {
  // Convention: the LLM returns kebab-cased slide ids. Map to the deck's
  // actual data-section strings.
  const map = {
    'hero':        '',                    // slide 1 in composer has empty data-section
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
    'attribution': '',                    // slide 12 also has empty data-section
  };
  return map[slideId] ?? slideId;
}

function cssEscape(s) {
  // Minimal — good enough for the section strings we use. Uses CSS.escape when
  // available, falls back to simple attribute-value escaping.
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}
