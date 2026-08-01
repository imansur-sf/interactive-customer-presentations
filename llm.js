// LLM plumbing — same-origin call to the Express /api/llm endpoint.
//
// The server proxies requests to Google Gemini API with the API key
// secured as a Heroku config var. No client-side API key needed.
//
// The system prompt (skill context) is still assembled client-side
// and sent to the server, which forwards it to Gemini.

// Tier mapping: old model names → Gemini tiers
// The server picks the actual Gemini model based on tier.
const TIER_MAP = {
  opus:   'powerful',
  sonnet: 'balanced',
  haiku:  'fast',
};
const DEFAULT_TIER = 'powerful';

// -------------------- Public API --------------------

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
 * then posts to the same-origin /api/llm endpoint which proxies to Gemini.
 */
export async function callLLM(payload) {
  return callServer(payload);
}
// Back-compat alias for older imports.
export const callWorker = callLLM;

// -------------------- Server proxy path --------------------
async function callServer(payload) {
  const {
    turn = 'answer',
    questionId,
    slideId,
    userMessage = '',
    deckContext = {},
    questionSchema,
    model = 'opus',
  } = payload || {};

  const tier = TIER_MAP[model] || DEFAULT_TIER;
  const systemText = await buildSystemText();
  const { userPrompt, tool } = buildTurnPrompt({
    turn, questionId, slideId, userMessage, deckContext, questionSchema,
  });

  const body = {
    prompt: userPrompt,
    system: systemText,
    tier,
    maxTokens: 8192,
    tools: [{
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    }],
    toolChoice: tool.name,
  };

  let res;
  try {
    res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throwUser(
      'server_unreachable',
      `Server not reachable: ${err.message}.`
    );
  }

  const raw = await res.text();
  const data = safeParse(raw);

  if (!res.ok) {
    const detail = data?.error || data?.body || raw.slice(0, 400);
    throwUser(
      `server_${res.status}`,
      renderErrorMessage(res.status, detail),
      { status: res.status, detail }
    );
  }
  if (!data) throwUser('bad_upstream_json', 'Server returned invalid JSON.');

  // The server returns { result: {...args}, functionName, model_used, tier, usage }
  const args = data.result;
  if (!args) {
    const preview = data.text_preview || data.text?.slice?.(0, 300) || 'no result in response';
    throwUser('no_tool_use', `Model did not return a tool call: ${preview}`);
  }

  return { ...args, _meta: { provider: 'gemini', model: data.model_used, tier: data.tier, usage: data.usage } };
}

function renderErrorMessage(status, detail) {
  if (status === 429) return 'Rate limited. Wait a moment and try again.';
  if (status === 503) return 'AI backend not configured. Contact the administrator.';
  if (status === 502) {
    if (typeof detail === 'string') {
      if (detail.includes('auth_failed')) return 'AI authentication failed. Contact the administrator.';
      if (detail.includes('rate_limited')) return 'AI rate limited. Wait a moment and try again.';
    }
    return 'AI backend error. Try again in a moment.';
  }
  const trimmed = typeof detail === 'string' ? detail.slice(0, 200) : '';
  if (status >= 500) return `Server returned ${status}${trimmed ? ` (${trimmed})` : ''}.`;
  return trimmed || `Request failed (${status}).`;
}

// -------------------- System prompt --------------------
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
    'You have been loaded with the full Salesforce narrative deck design system below.',
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
      '- CRITICAL: You MUST populate the `values` object with a concrete suggestion for EVERY field key listed in the question schema. These values are programmatically inserted into form fields — empty or missing values break the user experience.',
      '- For text/textarea fields: return the full suggested text as a string. NEVER return an empty string.',
      '- For radio fields: return one of the exact option strings from the schema.',
      '- For multiselect fields: return an array of selected option strings.',
      '- For kpi-grid fields: return an array of 4 objects, each with {value, unit, label, framing}. Use whole integers, respect Reduce/Improve framing, keep labels ≤10 words.',
      '- For beachheads fields: return an array of 2 objects, each with {title, before, after, ttv}. bc-title ≤6 words, before/after ≤15 words.',
      '- If a field has fixed options, prefer one of those unless none fit — in which case return a concise free-form value.',
      '- Enforce every copy-length cap and voice rule from STYLE-GUIDE.md (no "but"/"however", parallel structure, ≤6-word titles, etc.).',
      '- If a customer website URL is provided in the answers (customer_url), use your knowledge of that company — their products, market position, challenges, and competitive landscape — to make suggestions specific and relevant to their business.',
      '- If prior answers are sparse, make reasonable industry-appropriate assumptions. Research the customer name if you know them. NEVER return empty values — always provide a thoughtful, specific suggestion.',
      '- The rationale should be ONE concise sentence explaining your suggestion. Keep it brief — the field values are what matter most.',
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
