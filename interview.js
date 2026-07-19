// Interview engine — 14 questions from SKILL.md, rendered as rich inline
// widgets in the chat pane. Answers accumulate into a single `deckContext`
// object that gets sent to the Worker once, at the end, to generate the deck.
//
// Widget types:
//   text        — single-line input
//   textarea    — multi-line input
//   radio       — button group (single select)
//   multiselect — chip group (0+ selected)
//   hex         — color picker
//   kpi-grid    — 4 rows of { value, unit, label }
//   beachheads  — 2 rows of { title, before, after, ttv }
//   stack       — SF products (multi) + customer systems (text)
//   goal-parts  — Bowden goal as 4 sub-fields (audience, action, deadline, wiifm, kpi)
//   phases      — Phase 1 + Phase 2 (2 textareas)
//   closing     — Three-step CTA (3 fields)

export const QUESTIONS = [
  {
    id: 'customer-name',
    prompt: "Let's start with the basics. Who is this deck for?",
    fields: [{ key: 'customer', type: 'text', placeholder: 'e.g. Westpac', required: true, label: 'Customer name' }],
  },
  {
    id: 'industry',
    prompt: 'What industry are they in?',
    fields: [{
      key: 'industry', type: 'radio', required: true,
      options: [
        'Retail / Consumer Goods',
        'Financial Services',
        'Healthcare & Life Sciences',
        'Manufacturing / Automotive',
        'Technology',
        'Public Sector',
        'Media & Entertainment',
        'Travel & Hospitality',
        'Other',
      ],
    }],
  },
  {
    id: 'audience',
    prompt: "Who's the primary audience, and where are you in the relationship?",
    fields: [
      { key: 'audience_role', type: 'radio', label: 'Audience', required: true,
        options: ['Economic buyer', 'Technical buyer', 'Both'] },
      { key: 'relationship_stage', type: 'radio', label: 'Relationship', required: true,
        options: ['First meeting', 'Existing relationship', 'Pre-close'] },
      { key: 'audience_type', type: 'radio', label: 'Meeting type', required: true,
        options: ['Customer meeting', 'Internal review'] },
    ],
  },
  {
    id: 'deck-type',
    prompt: 'What type of deck is this? This shapes the entire narrative structure.',
    help: 'Tell-Show-Tell opens with insight, demonstrates, then closes with the path forward — best for first meetings. POV leads with a specific commercial opinion — best for exec follow-ups. Proposal is outcome-first, ROI-anchored — best for late-stage sign-off.',
    fields: [{
      key: 'deck_type', type: 'radio', required: true,
      options: ['Tell-Show-Tell', 'POV (Point of View)', 'Proposal / Business Case'],
    }],
  },
  {
    id: 'bowden-goal',
    prompt: "Let's write the Bowden goal statement together. It's the single sentence the whole deck serves.",
    help: 'Format: Convince [audience] to [action] by [deadline]. They should care because [WIIFM]. The business priority this supports is [KPI].',
    fields: [
      { key: 'goal_audience', type: 'text', label: 'Audience (who)', placeholder: 'the CDO and their data-platform team', required: true },
      { key: 'goal_action', type: 'text', label: 'Action (what should they do)', placeholder: "commit to a 6-week Data Cloud POC", required: true },
      { key: 'goal_deadline', type: 'text', label: 'By when', placeholder: 'end of Q3', required: true },
      { key: 'goal_wiifm', type: 'textarea', label: "What's in it for them (WIIFM)", placeholder: "unified profiles across 4 acquired brands unlock cross-sell + AI-ready data foundation", required: true },
      { key: 'goal_kpi', type: 'text', label: 'Business priority / KPI this supports', placeholder: '30% lift in cross-brand cross-sell', required: true },
    ],
  },
  {
    id: 'leading-statement',
    prompt: 'What contentious-but-reasonable belief should the audience leave holding? This becomes the hero H1.',
    help: 'Should be slightly challengeable and provable by the deck\'s evidence. Not a truism.',
    fields: [{ key: 'leading_statement', type: 'textarea', required: true, rows: 3, placeholder: "e.g. Retailers who unify data win the next decade — everyone else becomes a commodity storefront." }],
  },
  {
    id: 'gap',
    prompt: "Now the Gap — what's broken today, and what does good look like tomorrow?",
    help: "Give 2–3 specifics for each side. Keep them concrete, not vague.",
    fields: [
      { key: 'gap_today', type: 'textarea', label: "Today's pain", rows: 4, required: true, placeholder: "e.g.\n- Onboarding new brands takes 6+ months of manual data mapping\n- Marketing has no live view of customer preferences across brands" },
      { key: 'gap_tomorrow', type: 'textarea', label: 'Tomorrow', rows: 4, required: true, placeholder: "e.g.\n- New brands onboarded in 4 weeks with pre-built connectors\n- Real-time unified profile drives every campaign in every brand" },
    ],
  },
  {
    id: 'why-now',
    prompt: 'Why now? What external pressure makes this the right moment, and what does waiting 6 months cost?',
    fields: [
      { key: 'why_now_pressure', type: 'textarea', label: 'External pressure / market event', rows: 3, required: true },
      { key: 'why_now_cost', type: 'textarea', label: 'Cost of waiting 6 months', rows: 3, required: true },
    ],
  },
  {
    id: 'hero-kpis',
    prompt: 'Give me 4 hero KPIs — the numbers that carry the narrative. Frame with at least one Reduce (cost/time saved) and one Improve (outcome gained).',
    fields: [{ key: 'hero_kpis', type: 'kpi-grid', required: true }],
  },
  {
    id: 'stack',
    prompt: "Which Salesforce products are in scope? And any customer-side systems that need to appear in the stack (like their CDP or data warehouse)?",
    help: "Max 7 layers total. Customer systems always go at layer 1–2 (foundation).",
    fields: [
      { key: 'stack_sf', type: 'multiselect', label: 'Salesforce products', required: true,
        options: ['Data Cloud', 'Agentforce', 'Marketing Cloud', 'Sales Cloud', 'Service Cloud', 'Commerce Cloud', 'Experience Cloud', 'Loyalty Management', 'MuleSoft', 'Slack', 'Platform', 'Tableau', 'Einstein'] },
      { key: 'stack_customer', type: 'textarea', label: 'Customer-side systems (optional)', rows: 2, placeholder: 'e.g. Snowflake warehouse, legacy Adobe Campaign, custom mobile app' },
    ],
  },
  {
    id: 'beachheads',
    prompt: 'Beachheads — the two 90-day wins to lead with. For each: name, today\'s state, tomorrow\'s outcome, time-to-value.',
    fields: [{ key: 'beachheads', type: 'beachheads', required: true }],
  },
  {
    id: 'proof',
    prompt: 'Do you have a customer quote, reference stat, or case study to anchor credibility? If not, use an industry benchmark ("Industry average: X").',
    fields: [{ key: 'proof', type: 'textarea', required: true, rows: 4, placeholder: 'e.g. "We went from 3 months to 3 weeks on new brand onboarding." — CDO, Peer retailer\nOr: Industry average: unified-profile programs return 3.2x within 18 months (Forrester TEI, 2025).' }],
  },
  {
    id: 'roadmap',
    prompt: 'Roadmap in two phases. Phase 1 is the beachhead deliverables; Phase 2 is scale + vision.',
    fields: [
      { key: 'phase_1', type: 'textarea', label: 'Phase 1 (0–90 days)', rows: 3, required: true, placeholder: 'e.g. Data Cloud POC live for 2 brands, unified profile v1, Agentforce service pilot' },
      { key: 'phase_2', type: 'textarea', label: 'Phase 2 (6+ months)', rows: 3, required: true, placeholder: 'e.g. All 4 brands unified, marketing on real-time journeys, predictive replenishment' },
    ],
  },
  {
    id: 'closing',
    prompt: 'Closing CTA — three steps. Step 1 is what they do THIS WEEK. Step 3 must end on an outcome, not a process.',
    fields: [
      { key: 'closing_step_1', type: 'text', label: 'This week', required: true, placeholder: 'e.g. Confirm POC scope in a 60-min working session with Data + Marketing' },
      { key: 'closing_step_2', type: 'text', label: 'Medium-term', required: true, placeholder: 'e.g. Approve 6-week POC start' },
      { key: 'closing_step_3', type: 'text', label: 'Destination / outcome', required: true, placeholder: 'e.g. A unified customer view powering every brand in your portfolio' },
    ],
  },
  {
    id: 'accent',
    prompt: "What's the customer's primary brand color? This becomes the `--accent` variable used across the deck.",
    fields: [{ key: 'accent_hex', type: 'hex', required: true, placeholder: '#DA1710' }],
  },
  {
    id: 'animations',
    prompt: 'Which animated slides do you want to include? (Optional — pick any combination.)',
    fields: [{
      key: 'animations', type: 'multiselect',
      options: [
        'AI in Action (typewriter chat + journey stream)',
        'Data Pipeline (nodes + flowing packets + countUp)',
        'Architecture Diagram (sequential reveal + traveling packets)',
        'CountUp Hero KPIs (recommended for all decks)',
      ],
    }],
  },
];

export class InterviewController {
  constructor({ container, onComplete, appendMessage, onSuggest }) {
    this.container = container;   // the chat log element
    this.onComplete = onComplete; // called with the collected deckContext
    this.appendMessage = appendMessage;
    this.onSuggest = onSuggest;   // (questionId, questionSchema, answersSoFar) → Promise<{values, rationale}>
    this.index = 0;
    this.answers = {};
  }

  start() {
    this.index = 0;
    this.answers = {};
    this.renderQuestion();
  }

  renderQuestion() {
    const q = QUESTIONS[this.index];
    if (!q) return this.finish();

    // Ask the question
    const msg = document.createElement('div');
    msg.className = 'msg assistant';
    msg.innerHTML = `
      <div class="msg-label">Decktools · ${this.index + 1} of ${QUESTIONS.length}</div>
      <div class="q-prompt">${escapeHtml(q.prompt)}</div>
      ${q.help ? `<div class="q-help">${escapeHtml(q.help)}</div>` : ''}
    `;
    this.container.appendChild(msg);

    // Render the widget
    const widget = this.renderWidget(q);
    this.container.appendChild(widget);
    this.container.scrollTop = this.container.scrollHeight;
  }

  renderWidget(q) {
    const wrap = document.createElement('div');
    wrap.className = 'q-widget';

    const state = {};
    const setters = {}; // field.key → (value) => void — used by Suggest

    q.fields.forEach((field) => {
      const fieldEl = document.createElement('div');
      fieldEl.className = 'q-field';
      if (field.label) {
        const lbl = document.createElement('div');
        lbl.className = 'q-field-label';
        lbl.textContent = field.label + (field.required ? ' *' : '');
        fieldEl.appendChild(lbl);
      }

      const { el, setValue } = this.renderControl(field, (val) => { state[field.key] = val; validate(); });
      setters[field.key] = setValue;
      fieldEl.appendChild(el);
      wrap.appendChild(fieldEl);
    });

    // Compound widgets seed state so their key exists in `state`
    const compound = q.fields.find((f) => f.type === 'kpi-grid' || f.type === 'beachheads');
    if (compound) {
      state[compound.key] = compound.type === 'kpi-grid' ? [{}, {}, {}, {}] : [{}, {}];
    }

    // Actions row: Suggest (left) + Submit (right)
    const actions = document.createElement('div');
    actions.className = 'q-actions';

    const suggestBtn = document.createElement('button');
    suggestBtn.type = 'button';
    suggestBtn.className = 'q-suggest';
    suggestBtn.innerHTML = '<span class="sparkle">✨</span> Suggest an answer';
    suggestBtn.title = 'Ask the AI to fill this question for you based on what it knows so far.';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'q-submit';
    submitBtn.textContent = this.index === QUESTIONS.length - 1 ? 'Generate deck →' : 'Next →';

    actions.appendChild(suggestBtn);
    actions.appendChild(submitBtn);
    wrap.appendChild(actions);

    // Validate required fields
    const validate = () => {
      let ok = true;
      for (const f of q.fields) {
        if (!f.required) continue;
        const v = state[f.key];
        if (v == null) { ok = false; break; }
        if (typeof v === 'string' && !v.trim()) { ok = false; break; }
        if (Array.isArray(v)) {
          if (v.length === 0) { ok = false; break; }
          if (f.type === 'kpi-grid' && !v.every((r) => r.value && r.label)) { ok = false; break; }
          if (f.type === 'beachheads' && !v.every((r) => r.title && r.before && r.after)) { ok = false; break; }
        }
      }
      submitBtn.disabled = !ok;
    };
    validate();

    // Suggest button — ask the LLM to fill this question
    suggestBtn.addEventListener('click', async () => {
      if (!this.onSuggest) return;
      const prev = suggestBtn.innerHTML;
      suggestBtn.disabled = true;
      suggestBtn.innerHTML = '<span class="spinner"></span>Suggesting…';
      try {
        const { values = {}, rationale } = await this.onSuggest(q.id, q, this.answers);
        // Apply suggested values via each field's setter
        for (const [key, val] of Object.entries(values)) {
          const set = setters[key];
          if (set) set(val);
        }
        // Flash-highlight the filled inputs for visual feedback
        wrap.querySelectorAll('.q-input, .q-textarea, .q-chip.selected').forEach((el) => {
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 900);
        });
        if (rationale) this.appendMessage('assistant', `✨ ${rationale}`);
      } catch (err) {
        console.error('suggest failed', err);
        this.appendMessage('assistant', `⚠️ Couldn't generate a suggestion: ${err.userMessage || err.message}`);
      } finally {
        suggestBtn.disabled = false;
        suggestBtn.innerHTML = prev;
      }
    });

    // Submit — advance to next question
    submitBtn.addEventListener('click', () => {
      this.appendMessage('user', summariseAnswer(q, state));
      Object.assign(this.answers, state);
      wrap.querySelectorAll('input, textarea, button').forEach((el) => el.disabled = true);
      wrap.style.opacity = '0.6';
      this.index++;
      this.renderQuestion();
    });

    return wrap;
  }

  // Every renderControl branch returns { el, setValue }. The setValue takes
  // the same shape as the emitted value and updates the DOM + internal state
  // to match — used by the Suggest button.
  renderControl(field, onChange) {
    if (field.type === 'text' || field.type === 'hex') {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = field.placeholder || '';
      input.className = 'q-input';
      input.addEventListener('input', () => onChange(input.value));
      return {
        el: input,
        setValue: (val) => { input.value = String(val ?? ''); onChange(input.value); },
      };
    }
    if (field.type === 'textarea') {
      const t = document.createElement('textarea');
      t.rows = field.rows || 3;
      t.placeholder = field.placeholder || '';
      t.className = 'q-textarea';
      t.addEventListener('input', () => onChange(t.value));
      return {
        el: t,
        setValue: (val) => { t.value = String(val ?? ''); onChange(t.value); },
      };
    }
    if (field.type === 'radio') {
      return renderChoiceControl(field, 'single', onChange);
    }
    if (field.type === 'multiselect') {
      return renderChoiceControl(field, 'multi', onChange);
    }
    if (field.type === 'kpi-grid') {
      const g = document.createElement('div');
      g.className = 'q-kpi-grid';
      const rows = [{}, {}, {}, {}];
      const framings = ['Reduce', 'Reduce', 'Improve', 'Improve'];
      const inputRefs = [];
      rows.forEach((_, i) => {
        const row = document.createElement('div');
        row.className = 'q-kpi-row';
        row.innerHTML = `
          <div class="q-kpi-tag">${framings[i]}</div>
          <input type="text" class="q-input q-kpi-value" placeholder="30" />
          <input type="text" class="q-input q-kpi-unit" placeholder="%" />
          <input type="text" class="q-input q-kpi-label" placeholder="reduction in onboarding time" />
        `;
        const [valEl, unitEl, labelEl] = row.querySelectorAll('input');
        inputRefs.push({ valEl, unitEl, labelEl });
        const emit = () => {
          rows[i] = { value: valEl.value, unit: unitEl.value, label: labelEl.value, framing: framings[i] };
          onChange([...rows]);
        };
        valEl.addEventListener('input', emit);
        unitEl.addEventListener('input', emit);
        labelEl.addEventListener('input', emit);
        g.appendChild(row);
      });
      return {
        el: g,
        setValue: (arr) => {
          if (!Array.isArray(arr)) return;
          arr.slice(0, 4).forEach((row, i) => {
            if (!row) return;
            const { valEl, unitEl, labelEl } = inputRefs[i];
            valEl.value = String(row.value ?? '');
            unitEl.value = String(row.unit ?? '');
            labelEl.value = String(row.label ?? '');
            rows[i] = { value: valEl.value, unit: unitEl.value, label: labelEl.value, framing: framings[i] };
          });
          onChange([...rows]);
        },
      };
    }
    if (field.type === 'beachheads') {
      const g = document.createElement('div');
      g.className = 'q-beachheads';
      const rows = [{}, {}];
      const inputRefs = [];
      rows.forEach((_, i) => {
        const row = document.createElement('div');
        row.className = 'q-bh-row';
        row.innerHTML = `
          <div class="q-bh-header">Use case ${i + 1}</div>
          <input type="text" class="q-input" placeholder="Name (e.g. Onboarding Copilot)" data-k="title" />
          <input type="text" class="q-input" placeholder="Time to value (e.g. 6 weeks)" data-k="ttv" />
          <textarea class="q-textarea" placeholder="Before (today's pain)" rows="2" data-k="before"></textarea>
          <textarea class="q-textarea" placeholder="After (outcome)" rows="2" data-k="after"></textarea>
        `;
        const inputs = row.querySelectorAll('[data-k]');
        const byKey = {};
        inputs.forEach((el) => byKey[el.dataset.k] = el);
        inputRefs.push(byKey);
        const emit = () => {
          const obj = {};
          inputs.forEach((el) => obj[el.dataset.k] = el.value);
          rows[i] = obj;
          onChange([...rows]);
        };
        inputs.forEach((el) => el.addEventListener('input', emit));
        g.appendChild(row);
      });
      return {
        el: g,
        setValue: (arr) => {
          if (!Array.isArray(arr)) return;
          arr.slice(0, 2).forEach((row, i) => {
            if (!row) return;
            const refs = inputRefs[i];
            ['title', 'ttv', 'before', 'after'].forEach((k) => {
              if (refs[k] && row[k] != null) refs[k].value = String(row[k]);
            });
            const obj = {};
            Object.entries(refs).forEach(([k, el]) => obj[k] = el.value);
            rows[i] = obj;
          });
          onChange([...rows]);
        },
      };
    }
    // Fallback
    const span = document.createElement('span');
    span.textContent = `[unsupported: ${field.type}]`;
    return { el: span, setValue: () => {} };
  }

  finish() {
    this.appendMessage('assistant', "Perfect — I've got everything I need. Generating the deck now…");
    this.onComplete(this.answers);
  }
}

// ------------------------------------------------------------------ Choice control
//
// Renders a chip group for radio ('single') or multiselect ('multi'). Adds an
// "Other…" chip that reveals a free-form input so users can supply a response
// not covered by the preset options.
//
//  single:  answer is the selected option string, OR the trimmed Other-input value
//  multi:   answer is an array of selected option strings + comma-split Other tokens
function renderChoiceControl(field, mode, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'q-choice';

  const chipRow = document.createElement('div');
  chipRow.className = 'q-chips';
  wrap.appendChild(chipRow);

  const otherRow = document.createElement('div');
  otherRow.className = 'q-other-row';
  const otherInput = document.createElement('input');
  otherInput.type = 'text';
  otherInput.className = 'q-input q-other-input';
  otherInput.placeholder = mode === 'multi'
    ? 'Type your own — separate multiple with commas'
    : 'Type your own answer…';
  otherRow.appendChild(otherInput);
  wrap.appendChild(otherRow);

  const selected = new Set();      // preset options selected
  let otherActive = false;         // is Other chip toggled on?
  let otherValue = '';             // free-form value

  const OPTIONS = [...field.options, '__OTHER__'];

  const chipRefs = new Map();

  function emit() {
    if (mode === 'single') {
      if (otherActive) {
        const val = otherValue.trim();
        onChange(val || null);
      } else {
        const first = selected.values().next().value;
        onChange(first ?? null);
      }
    } else {
      const base = Array.from(selected);
      if (otherActive) {
        const tokens = otherValue.split(',').map((s) => s.trim()).filter(Boolean);
        onChange([...base, ...tokens]);
      } else {
        onChange(base);
      }
    }
  }

  OPTIONS.forEach((opt) => {
    const isOther = opt === '__OTHER__';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'q-chip';
    if (isOther) chip.classList.add('q-chip-other');
    chip.textContent = isOther ? 'Other…' : opt;
    chip.addEventListener('click', () => {
      if (isOther) {
        otherActive = !otherActive;
        chip.classList.toggle('selected', otherActive);
        otherRow.classList.toggle('visible', otherActive);
        if (mode === 'single' && otherActive) {
          // Single-select: choosing Other clears other selections
          selected.clear();
          chipRefs.forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
        }
        if (otherActive) otherInput.focus();
        emit();
      } else {
        if (mode === 'single') {
          selected.clear();
          chipRefs.forEach((c) => c.classList.remove('selected'));
          otherActive = false;
          chipRefs.get('__OTHER__')?.classList.remove('selected');
          otherRow.classList.remove('visible');
          selected.add(opt);
          chip.classList.add('selected');
        } else {
          if (selected.has(opt)) { selected.delete(opt); chip.classList.remove('selected'); }
          else { selected.add(opt); chip.classList.add('selected'); }
        }
        emit();
      }
    });
    chipRefs.set(opt, chip);
    chipRow.appendChild(chip);
  });

  otherInput.addEventListener('input', () => { otherValue = otherInput.value; emit(); });

  // Seed initial value for multi (empty array) so validation has something to check
  if (mode === 'multi') onChange([]);

  return {
    el: wrap,
    setValue: (val) => {
      // Suggest may return: for single → a string (may or may not be in options)
      //                    for multi  → an array of strings (may contain non-option values)
      selected.clear();
      chipRefs.forEach((c) => c.classList.remove('selected'));
      otherActive = false;
      otherValue = '';
      otherInput.value = '';
      otherRow.classList.remove('visible');
      chipRefs.get('__OTHER__')?.classList.remove('selected');

      if (mode === 'single') {
        if (typeof val !== 'string' || !val.trim()) { emit(); return; }
        if (field.options.includes(val)) {
          selected.add(val);
          chipRefs.get(val)?.classList.add('selected');
        } else {
          otherActive = true;
          otherValue = val;
          otherInput.value = val;
          chipRefs.get('__OTHER__')?.classList.add('selected');
          otherRow.classList.add('visible');
        }
        emit();
      } else {
        const arr = Array.isArray(val) ? val : [];
        const custom = [];
        arr.forEach((v) => {
          if (typeof v !== 'string' || !v.trim()) return;
          if (field.options.includes(v)) {
            selected.add(v);
            chipRefs.get(v)?.classList.add('selected');
          } else {
            custom.push(v);
          }
        });
        if (custom.length) {
          otherActive = true;
          otherValue = custom.join(', ');
          otherInput.value = otherValue;
          chipRefs.get('__OTHER__')?.classList.add('selected');
          otherRow.classList.add('visible');
        }
        emit();
      }
    },
  };
}

// ------------------------------------------------------------------ helpers
function summariseAnswer(q, state) {
  const parts = [];
  for (const f of q.fields) {
    const v = state[f.key];
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      if (f.type === 'kpi-grid') {
        parts.push(v.filter(k => k.value).map((k) => `${k.value}${k.unit || ''} ${k.label}`).join(' · '));
      } else if (f.type === 'beachheads') {
        parts.push(v.map((b) => b.title).filter(Boolean).join(', '));
      } else {
        parts.push(v.join(', '));
      }
    } else {
      parts.push(String(v).slice(0, 160));
    }
  }
  return parts.join(' · ') || '(answered)';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
