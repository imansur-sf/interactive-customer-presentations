// LLM plumbing — direct BYOK call to the Salesforce LLM Gateway Express.
//
// Topology (a): the browser posts OpenAI-shape chat/completions directly to
// the SF LLM Gateway using the user's BYOK key from localStorage. No worker
// in the LLM auth path. Requires the Salesforce VPN to reach the gateway host.
//
// The worker still exists to pass /imranAI/track events through to the
// decktools tracker, but it is NOT called from this file.

export const SF_GATEWAY_URL =
  'https://eng-ai-model-gateway.sfproxy.devx-preprod.aws-esvc1-useast2.aws.sfdc.cl/v1/chat/completions';

// Kept for back-compat with older imports (Settings UI, etc.). Unused for LLM.
export const DEFAULT_LEGACY_WORKER_URL = 'https://icp-imranai-llm.imansur.workers.dev';
export const DEFAULT_WORKER_URL = DEFAULT_LEGACY_WORKER_URL;

const LS = {
  workerUrl: 'icp.workerUrl',
  workerUrlLegacy: 'icp.legacyWorkerUrl',
  byokKey: 'icp.byokKey',
  apiKeyLegacy: 'icp.apiKey',
};

const MODELS = {
  opus:   'claude-sonnet-4-5-20250929',
  sonnet: 'claude-sonnet-4-20250514',
  haiku:  'claude-3-5-sonnet-20240620-v1',
};
const DEFAULT_MODEL = 'opus';

// -------------------- Public API --------------------
export function getWorkerUrl() {
  return (
    localStorage.getItem(LS.workerUrl) ||
    localStorage.getItem(LS.workerUrlLegacy) ||
    DEFAULT_LEGACY_WORKER_URL
  ).trim();
}
export function getLegacyWorkerUrl() { return getWorkerUrl(); }

export function getApiKey() {
  return (
    localStorage.getItem(LS.byokKey) ||
    localStorage.getItem(LS.apiKeyLegacy) ||
    ''
  ).trim();
}

/**
 * Detect which upstream path this call should use. With topology (a) there is
 * only one path — direct browser → SF gateway — plus a "no key" sentinel that
 * the UI uses to trigger the BYOK onboarding modal.
 */
export function detectRoute() {
  return getApiKey() ? 'gateway-direct' : 'no-key';
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
 * The unified LLM call. Builds the system prompt and tool schema in-browser,
 * then posts OpenAI-shape chat/completions to the SF LLM Gateway with the
 * BYOK key from localStorage.
 */
export async function callLLM(payload) {
  return callGateway(payload);
}
// Back-compat alias for older imports.
export const callWorker = callLLM;

// -------------------- Direct SF Gateway path --------------------
async function callGateway(payload) {
  const key = getApiKey();
  if (!key) {
    throwUser(
      'no_api_key',
      'No SF LLM Gateway key set. Paste your key in Settings to enable the AI turns.'
    );
  }

  const {
    turn = 'answer',
    questionId,
    slideId,
    userMessage = '',
    deckContext = {},
    questionSchema,
    model = DEFAULT_MODEL,
  } = payload || {};

  const modelId = MODELS[model] || MODELS[DEFAULT_MODEL];
  const systemText = await buildSystemText();
  const { userPrompt, tool } = buildTurnPrompt({
    turn, questionId, slideId, userMessage, deckContext, questionSchema,
  });

  const body = {
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

  let res;
  try {
    res = await fetch(SF_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throwUser(
      'gateway_unreachable',
      `SF LLM Gateway not reachable: ${err.message}. Are you on the Salesforce VPN?`
    );
  }

  const raw = await res.text();
  const data = safeParse(raw);
  if (!res.ok) {
    const detail = data?.error?.message || raw.slice(0, 400);
    throwUser(
      `gateway_${res.status}`,
      renderErrorMessage(res.status, detail),
      { status: res.status, detail }
    );
  }
  if (!data) throwUser('bad_upstream_json', 'Gateway returned invalid JSON.');

  const choice = data.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall) {
    const preview = choice?.message?.content?.slice?.(0, 300) || 'no tool_calls in response';
    throwUser('no_tool_use', `Model did not return a tool call: ${preview}`);
  }
  const rawArgs = toolCall.function?.arguments;
  const args = typeof rawArgs === 'string' ? safeParse(rawArgs) : rawArgs;
  if (!args) throwUser('bad_tool_arguments', 'Tool call arguments were not valid JSON.');

  return { ...args, _meta: { provider: 'llm-gateway', model: modelId, usage: data.usage } };
}

function renderErrorMessage(status, detail) {
  if (status === 401) return 'Auth failed. Double-check your SF LLM Gateway key in Settings.';
  if (status === 403) return 'Access denied. Your key may not have permission for this model.';
  if (status === 429) return 'Rate limited by the gateway. Wait a moment and try again.';
  if (status === 503) return 'The gateway upstream failed. Try again in a moment.';
  const trimmed = typeof detail === 'string' ? detail.slice(0, 200) : '';
  if (status >= 500) return `Gateway returned ${status}${trimmed ? ` (${trimmed})` : ''}.`;
  return trimmed || `Request failed (${status}).`;
}

// -------------------- System prompt (was on the worker) --------------------
let _skillCache = null;
async function loadSkillContext() {
  if (_skillCache) return _skillCache;
  const base = './skill-context/';
  const fetchText = async (name) => {
    const r = await fetch(base + name, { cache: 'force-cache' });
    if (!r.ok) throw new Error(`${name} fetch failed: ${r.status}`);
    return r.text();
  };
  try {
    const [skill, style, principles, composer] = await Promise.all([
      fetchText('SKILL.md'),
      fetchText('STYLE-GUIDE.md'),
      fetchText('SLIDE-PRINCIPLES.md'),
      fetchText('sf-composer.html'),
    ]);
    _skillCache = { skill, style, principles, composer };
  } catch (err) {
    throwUser(
      'skill_context_unavailable',
      `Could not load deck skill bundle: ${err.message}. Ensure skill-context/ is served alongside index.html.`
    );
  }
  return _skillCache;
}

async function buildSystemText() {
  const { skill, style, principles, composer } = await loadSkillContext();
  const preamble = [
    'You are the sf-decktools narrative deck builder.',
    'You have been loaded with the full Salesforce narrative deck design system below — the same skill that Claude Code users get when they install sf-decktools.',
    'Follow every rule in SKILL.md, STYLE-GUIDE.md, and SLIDE-PRINCIPLES.md strictly. They are non-negotiable.',
    'Your job on each turn is to return a JSON tool call describing patches to apply to the deck HTML.',
    '',
    'Rules of engagement:',
    '- Preserve `sf-composer.html`\'s structural conventions exactly. Do not invent new class names, sections, or components.',
    '- Copy quality is the point. Enforce all copy-length caps and voice rules (no "but"/"however", parallel structure in Gap rows, ≤6-word bc-titles, etc.).',
    '- 80/20 color rule: 80% primary blues, 20% max accent. Never override primary blues.',
    '- 2D icons only in narrative pages.',
    '- Return only via the requested tool call. Do not respond in prose.',
  ].join('\n');

  return [
    preamble,
    '---\n## SKILL.md — workflow + rules\n\n' + skill,
    '---\n## STYLE-GUIDE.md — voice, copy, brand\n\n' + style,
    '---\n## SLIDE-PRINCIPLES.md — per-slide design rules\n\n' + principles,
    '---\n## sf-composer.html — canonical reference deck (mirror this structure)\n\n```html\n' + composer + '\n```',
  ].join('\n\n');
}

function buildTurnPrompt({ turn, questionId, slideId, userMessage, deckContext, questionSchema }) {
  if (turn === 'suggest') {
    const suggestSchema = {
      type: 'object',
      required: ['values', 'rationale'],
      properties: {
        values: {
          type: 'object',
          description: 'Field key → value map. For radio: one of the options (or a free-form string if none fit). For multiselect: array of strings. For text/textarea: a string. For kpi-grid: array of {value, unit, label, framing}. For beachheads: array of {title, before, after, ttv}. Keys must match the field keys in the incoming questionSchema.',
          additionalProperties: true,
        },
        rationale: { type: 'string', description: 'One-sentence explanation of the suggestion, shown to the user in the chat.' },
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

  const patchSchema = {
    type: 'object',
    required: ['patches', 'message'],
    properties: {
      message: { type: 'string', description: 'One-sentence human-readable summary of what changed. Shown in the chat UI.' },
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
            slide_id: { type: 'string', description: 'The `data-section` value of the target slide (e.g. "hero", "why-now", "gap", "stack", "beachheads", "scale", "proof", "roadmap", "closing", "attribution"). Use "meta" for changes that live outside a slide (e.g. accent CSS variable, <html> attributes).' },
            selector: { type: 'string', description: 'CSS selector inside the slide (scoped to that slide). For "meta" patches, a global selector such as ":root" or "html".' },
            new_html: { type: 'string', description: 'The replacement outerHTML for the matched element. Must be valid HTML that fits inside its parent.' },
            op: { type: 'string', enum: ['replace', 'set-attribute', 'set-style'], description: 'Default is "replace". Use "set-attribute" or "set-style" when only a single attribute/style is being changed (then `new_html` is the value, and `selector` may include a `::attr(name)` or `::style(prop)` suffix).' },
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
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}
