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

// Deck type → slide order and hero style
export const DECK_TYPE_CONFIG = {
  'Tell-Show-Tell': {
    slideOrder: ['hero', 'why-now', 'gap', 'stack', 'ai-in-action', 'real-time', 'beachheads', 'scale', 'proof', 'roadmap', 'closing', 'thank-you'],
    heroStyle: 'insight-led',
    description: 'Open with insight, demonstrate, close with path forward',
  },
  'POV (Point of View)': {
    slideOrder: ['hero', 'gap', 'why-now', 'proof', 'stack', 'beachheads', 'closing', 'thank-you'],
    heroStyle: 'opinion-led',
    description: 'Lead with a bold commercial opinion, data-heavy, challenge-led',
  },
  'Proposal / Business Case': {
    slideOrder: ['hero', 'proof', 'gap', 'beachheads', 'roadmap', 'stack', 'closing', 'thank-you'],
    heroStyle: 'outcome-led',
    description: 'Outcome-first, ROI-anchored, designed to get sign-off',
  },
};

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
  const heavyTurns = ['generate', 'freeform', 'finalize'];
  if (heavyTurns.includes(payload?.turn)) {
    return callServerStream(payload);
  }
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

// -------------------- Streaming path (SSE — for heavy calls) --------------------
async function callServerStream(payload) {
  const {
    turn = 'answer',
    questionId,
    slideId,
    userMessage = '',
    deckContext = {},
    questionSchema,
    model = 'sonnet',
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
    maxTokens: 32768,
    tools: [{
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    }],
    toolChoice: tool.name,
  };

  let res;
  try {
    res = await fetch('/api/llm-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throwUser('server_unreachable', `Server not reachable: ${err.message}.`);
  }

  // If the server returned a non-SSE error (e.g. 400, 503 before streaming started)
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    const raw = await res.text();
    const data = safeParse(raw);
    const detail = data?.error || raw.slice(0, 400);
    throwUser(`server_${res.status}`, renderErrorMessage(res.status, detail), { status: res.status, detail });
  }

  // Parse SSE events from the stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on double newline (SSE event boundary)
    const parts = buffer.split('\n\n');
    buffer = parts.pop(); // Keep the incomplete last chunk

    for (const part of parts) {
      const lines = part.split('\n');
      let eventType = '';
      let dataStr = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr = line.slice(6);
      }

      if (eventType === 'heartbeat') continue; // Ignore keepalive

      if (eventType === 'error') {
        const errData = safeParse(dataStr) || {};
        throwUser('stream_error', errData.error || 'AI backend error. Try again in a moment.');
      }

      if (eventType === 'result') {
        const data = safeParse(dataStr);
        if (!data) throwUser('bad_stream_json', 'Server returned invalid streaming result.');
        const args = data.result;
        if (!args) throwUser('no_tool_use', 'Model did not return a tool call in streaming response.');
        return { ...args, _meta: { provider: 'gemini', model: data.model_used, tier: data.tier, usage: data.usage } };
      }
    }
  }

  throwUser('stream_incomplete', 'Streaming connection closed without a result. Please try again.');
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
    // Build explicit properties for the values object from the question's fields.
    // Gemini's function-calling API does NOT support additionalProperties, so we
    // must enumerate every field key the model should populate.
    const valueProps = {};
    const valueRequired = [];
    for (const f of (questionSchema?.fields || [])) {
      const k = f.key;
      if (f.type === 'multiselect') {
        valueProps[k] = { type: 'array', items: { type: 'string' }, description: `Selected options for: ${f.label || k}` };
      } else if (f.type === 'kpi-grid') {
        valueProps[k] = {
          type: 'array',
          description: 'Array of exactly 4 KPI objects. Each object must have: value (string, numeric), unit (string, e.g. %, x, hrs), label (string, max 10 words), framing (string, either Reduce or Improve).',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string', description: 'Numeric value as a string' },
              unit: { type: 'string', description: 'Unit like %, x, hrs, etc.' },
              label: { type: 'string', description: 'Short label, max 10 words' },
              framing: { type: 'string', description: 'Must be either Reduce (cost/time saved) or Improve (outcome gained)' },
            },
          },
        };
      } else if (f.type === 'beachheads') {
        const isSingle = f._singleIndex != null;
        valueProps[k] = {
          type: 'array',
          description: isSingle
            ? `Return exactly 1 beachhead use case object (suggesting for use case ${f._singleIndex + 1} of ${f._totalCount || 1}). The object MUST have ALL four fields populated: title (REQUIRED — the use case name, max 6 words, e.g. Onboarding Copilot), before (current state max 15 words), after (future state max 15 words), ttv (time to value e.g. 4 weeks). Do NOT leave title empty.`
            : 'Array of 1-4 beachhead use case objects matching the number requested. Each object MUST have ALL four fields populated: title (REQUIRED — the use case name, max 6 words, e.g. Onboarding Copilot), before (current state max 15 words), after (future state max 15 words), ttv (time to value e.g. 4 weeks). Do NOT leave title empty.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'REQUIRED — the use case name shown as the heading, e.g. Onboarding Copilot or Real-Time Segmentation. Max 6 words. Must not be empty.' },
              before: { type: 'string', description: 'Current state, max 15 words' },
              after: { type: 'string', description: 'Future state, max 15 words' },
              ttv: { type: 'string', description: 'Time to value, e.g. 4 weeks' },
            },
          },
        };
      } else {
        // text, textarea, radio, hex — all return strings
        let desc = `Value for: ${f.label || k}`;
        if (f.type === 'radio' && f.options) {
          desc += `. Choose one of: ${f.options.join(', ')}`;
        }
        valueProps[k] = { type: 'string', description: desc };
      }
      if (f.required) valueRequired.push(k);
    }

    const suggestSchema = {
      type: 'object',
      required: ['values', 'rationale'],
      properties: {
        values: {
          type: 'object',
          description: 'Concrete values for each field. You MUST populate every key listed here.',
          required: valueRequired.length ? valueRequired : undefined,
          properties: valueProps,
        },
        rationale: { type: 'string', description: 'One-sentence explanation of the suggestion, shown to the user in the chat.' },
      },
    };
    const tool = {
      name: 'suggest_answer',
      description: 'Propose a filled-in answer for the current interview question, based on the answers collected so far.',
      input_schema: suggestSchema,
    };
    const suggestLines = [
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
      '- For kpi-grid fields: return an array of KPI objects, each with {value, unit, label, framing}. Use whole integers, respect Reduce/Improve framing, keep labels ≤10 words.',
      '- For beachheads fields: return an array of 2 objects, each with {title, before, after, ttv}. bc-title ≤6 words, before/after ≤15 words.',
      '- If a field has fixed options, prefer one of those unless none fit — in which case return a concise free-form value.',
      '- Enforce every copy-length cap and voice rule from STYLE-GUIDE.md (no "but"/"however", parallel structure, ≤6-word titles, etc.).',
      '- If a customer website URL is provided in the answers (customer_url), use your knowledge of that company — their products, market position, challenges, and competitive landscape — to make suggestions specific and relevant to their business.',
      '- If prior answers are sparse, make reasonable industry-appropriate assumptions. Research the customer name if you know them. NEVER return empty values — always provide a thoughtful, specific suggestion.',
      '- The rationale should be ONE concise sentence explaining your suggestion. Keep it brief — the field values are what matter most.',
      '',
    ];

    // Inject meeting notes if available
    const meetingNotes = deckContext?.meetingNotes;
    if (meetingNotes && typeof meetingNotes === 'string' && meetingNotes.trim()) {
      suggestLines.push(
        'MEETING NOTES / CONTEXT (the user provided these — use them to inform your suggestions with real customer-specific details):',
        '```',
        meetingNotes.slice(0, 8000), // Cap to avoid overwhelming the context window
        '```',
        '',
      );
    }

    suggestLines.push('Return the suggestion via the `suggest_answer` tool.');
    const userPrompt = suggestLines.join('\n');
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
  if (turn === 'freeform') {
    userPrompt = [
      'The user is making a free-form request outside the standard interview flow.',
      `Their instruction: ${JSON.stringify(userMessage)}`,
      '',
      contextBlock,
      '',
      'Apply whatever changes the user requests as patches to the deck. This could be anything: creating new content, modifying existing slides, building architecture diagrams, rewriting copy, etc. Use your best judgment about which slide(s) to modify. If the request doesn\'t map to an existing slide, pick the most relevant one. Always return a helpful `message` explaining what you did.',
    ].join('\n');
  } else if (turn === 'edit') {
    userPrompt = [
      `The user is editing slide "${slideId || 'unknown'}".`,
      `Their instruction: ${JSON.stringify(userMessage)}`,
      '',
      contextBlock,
      '',
      'Apply the edit as one or more patches. Preserve every rule in SLIDE-PRINCIPLES.md for this slide. Do not touch other slides unless the instruction explicitly requires it.',
    ].join('\n');
  } else if (turn === 'generate') {
    const accentHex = deckContext?.answers?.accent_hex || '#DA1710';
    const customerName = deckContext?.answers?.customer || 'Customer';
    const customerUrl = deckContext?.answers?.customer_url || '';
    const logoUrl = deckContext?.logoUrl || '';
    // Safely extract hostname from customerUrl (may be missing protocol)
    let cobrandExtra = '';
    if (logoUrl) {
      cobrandExtra = ` Also replace the cobrand pill <img> src with "${logoUrl}".`;
    } else if (customerUrl) {
      try {
        const normalized = /^https?:\/\//i.test(customerUrl) ? customerUrl : 'https://' + customerUrl;
        const hostname = new URL(normalized).hostname;
        cobrandExtra = ` Also try to replace the cobrand pill <img> src — construct a likely logo URL from the customer domain (e.g. https://logo.clearbit.com/${hostname}).`;
      } catch (_) {
        cobrandExtra = ' Also try to replace the cobrand pill <img> src — construct a likely logo URL from the customer domain.';
      }
    }

    const generateLines = [
      'Generate the COMPLETE personalized deck from ALL interview answers.',
      '',
      contextBlock,
      '',
      'MANDATORY FIRST PATCHES (apply these BEFORE any slide content):',
      `1. ACCENT COLOR: The customer chose ${accentHex}. You MUST emit a "meta" patch: slide_id:"meta", op:"set-style", selector:":root::style(--accent)", new_html:"${accentHex}". Also emit a second meta patch for --accent-l with a 20% lighter variant of the same hue.`,
      `2. COBRAND PILL: Replace the text "SF Composer" inside .cobrand-pill <span> with "${customerName}".${cobrandExtra}`,
      '',
      'THEN generate patches for ALL slides with fully personalized content:',
      '- Hero: leading_statement as the big H1. Accent-colored eyebrow with industry tags. KPI stat-cards from hero_kpis (value + unit + label + framing).',
      '- Why Now: why_now_pressure (external force) + why_now_cost (cost of delay).',
      '- The Gap: gap_today (left column, pain points) vs gap_tomorrow (right column, outcomes).',
      '- How It Works: stack layers from stack_sf products + stack_customer systems. Customer systems at foundation layers.',
      '- AI in Action: personalized to the customer\'s primary use case.',
      '- Real-Time Data: personalized data-flow narrative for this customer.',
      '- Start Here: beachhead use cases from the beachheads array (title, before, after, ttv for each).',
      '- Where This Goes: scale vision tied to the beachheads.',
      '- What It Does Today: proof quote or stat from the proof field.',
      '- The Path Forward: phase_1 (0-90 days) + phase_2 (6+ months) roadmap items.',
      '- Next Steps: 3-step CTA from closing_step_1, closing_step_2, closing_step_3.',
      '- Thank You: keep Salesforce branding, add customer name. Keep the "Built on: Gemini AI / Heroku" card and SaaSy Solutions credits.',
      '',
      'COLOR RULES — ACCENT AS PRIMARY BACKGROUND:',
      `- The customer's accent color (${accentHex}) should be used as the PRIMARY BACKGROUND on key slides:`,
      '  * Hero slide: replace --grad-evening with a gradient from var(--accent-bg-dark) to var(--accent). Text color: var(--accent-fg).',
      '  * Dark slides (Why Now, Proof/What It Does Today, Closing/Next Steps, Thank You): use var(--accent) as solid background. Text: var(--accent-fg).',
      '  * The 3px accent stripe at top/bottom of these slides should use var(--accent-l) (lighter tint).',
      '- Light slides (Gap, Stack, Beachheads, Scale, Roadmap): keep white/light backgrounds. Use var(--accent) for badges, dots, card accent borders.',
      '- Use var(--accent-fg) for ALL text on accent-colored backgrounds (it auto-adjusts to white or dark based on contrast).',
      '- Salesforce primary blues (#001E5B, #022AC0, #066AFE, #00B3FF) should still appear on light slides for labels, eyebrows, and secondary text.',
      '',
      'COPY RULES:',
      '- ALL copy must be specific to the customer name, industry, and use cases. No generic placeholders.',
      '- Enforce every copy-length cap from STYLE-GUIDE.md (≤6-word bc-titles, ≤15-word before/after, etc.).',
    ];

    // Inject deck-type-specific slide order + hero style instructions
    const deckType = deckContext?.answers?.deck_type || 'Tell-Show-Tell';
    const dtConfig = DECK_TYPE_CONFIG[deckType] || DECK_TYPE_CONFIG['Tell-Show-Tell'];
    const activeSlides = dtConfig.slideOrder;
    const allSlides = DECK_TYPE_CONFIG['Tell-Show-Tell'].slideOrder; // full set
    const skippedSlides = allSlides.filter(s => !activeSlides.includes(s));

    generateLines.push(
      '',
      `DECK TYPE: "${deckType}" (${dtConfig.description})`,
      `ACTIVE SLIDES (in order): ${activeSlides.join(', ')}`,
      skippedSlides.length
        ? `SKIPPED SLIDES (do NOT generate patches for these): ${skippedSlides.join(', ')}`
        : 'All slides are active for this deck type.',
      '',
      'SLIDE ORDER: The patches you emit must target ONLY the active slides listed above.',
      'The front-end will reorder and hide slides based on the deck type — you do NOT need to change slide positions.',
      '',
      `HERO STYLE: "${dtConfig.heroStyle}"`,
      dtConfig.heroStyle === 'insight-led'
        ? '- Hero should open with a sharp industry insight or data point that creates urgency. The H1 should feel like a conference keynote opener.'
        : dtConfig.heroStyle === 'opinion-led'
        ? '- Hero should open with a bold, opinionated commercial thesis — a "we believe" statement that challenges the status quo. Make it provocative but defensible.'
        : '- Hero should open with a clear outcome statement — what the customer will achieve (ROI, efficiency gain, revenue impact). Lead with the business result, not the technology.',
    );

    // Inject meeting notes into generate prompt if available
    const genNotes = deckContext?.meetingNotes;
    if (genNotes && typeof genNotes === 'string' && genNotes.trim()) {
      generateLines.push(
        '',
        'MEETING NOTES / ADDITIONAL CONTEXT (use this to make the deck even more specific and relevant):',
        '```',
        genNotes.slice(0, 8000),
        '```',
      );
    }

    userPrompt = generateLines.join('\n');
  } else if (turn === 'progressive') {
    const targetSlides = deckContext?.targetSlides?.join(', ') || 'relevant';
    userPrompt = [
      `Progressive update: The user just answered interview question "${questionId}". Update ONLY the ${targetSlides} slide(s).`,
      '',
      contextBlock,
      '',
      'Apply patches ONLY for the specified target slide(s). Use the interview answers collected so far to fill in real, personalized content.',
      'If accent_hex is set in answers, use var(--accent) for accent elements on these slides.',
      'Do NOT touch other slides. Keep patches minimal and focused.',
    ].join('\n');
  } else if (turn === 'finalize') {
    userPrompt = [
      'Final polish pass: Review the ENTIRE deck for completeness and consistency.',
      '',
      contextBlock,
      '',
      'Check every slide for:',
      '1. Any remaining placeholder/template content that was not personalized — fill it with real content from the answers.',
      '2. Accent color consistency — var(--accent) should be used for eyebrows, badges, dots, card accents.',
      '3. Copy quality — enforce all STYLE-GUIDE.md rules (length caps, voice, no "but"/"however").',
      '4. Missing content — if any slide is still blank or has generic text, fill it from the answers.',
      'Only emit patches for things that actually need fixing. If everything looks good, return an empty patches array with a congratulatory message.',
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
