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
    fields: [
      { key: 'customer', type: 'text', placeholder: 'e.g. Westpac', required: true, label: 'Customer name' },
      { key: 'customer_url', type: 'text', placeholder: 'e.g. https://www.lululemon.com', required: false, label: 'Customer website (helps AI suggest better answers)' },
    ],
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
    prompt: 'Give me the hero KPIs — the numbers that carry the narrative. Start with at least one Reduce (cost/time saved) and one Improve (outcome gained). You can add up to 5.',
    fields: [{ key: 'hero_kpis', type: 'kpi-grid', required: true }],
  },
  {
    id: 'stack',
    prompt: "Which Salesforce products are in scope? And any customer-side systems that need to appear in the stack (like their CDP or data warehouse)?",
    help: "Max 7 layers total. Customer systems always go at layer 1–2 (foundation).",
    fields: [
      { key: 'stack_sf', type: 'multiselect', label: 'Salesforce products', required: true,
        options: ['Data Cloud', 'Agentforce', 'Sales Cloud', 'Service Cloud', 'Commerce Cloud', 'Experience Cloud',
          'Marketing Cloud Engagement (ExactTarget)', 'Marketing Cloud Account Engagement (Pardot)', 'Marketing Cloud Advanced (Next-Gen)',
          'Marketing Cloud Intelligence (Datorama)', 'Marketing Intelligence (Next-Gen)',
          'Salesforce Personalization (Next-Gen)', 'Marketing Cloud Personalization (Interaction Studio)',
          'Loyalty Management', 'Referral Management', 'MuleSoft', 'Slack', 'Platform', 'Tableau', 'Einstein'] },
      { key: 'stack_customer', type: 'textarea', label: 'Customer-side systems (optional)', rows: 2, placeholder: 'e.g. Snowflake warehouse, legacy Adobe Campaign, custom mobile app' },
    ],
  },
  {
    id: 'beachheads',
    prompt: 'Use cases — the 90-day wins to lead with. Start with one; add up to 4. For each: name, today\'s state, tomorrow\'s outcome, time-to-value.',
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
  constructor({ container, onComplete, appendMessage, onSuggest, onAnswer }) {
    this.container = container;   // the chat log element
    this.onComplete = onComplete; // called with the collected deckContext
    this.appendMessage = appendMessage;
    this.onSuggest = onSuggest;   // (questionId, questionSchema, answersSoFar) → Promise<{values, rationale}>
    this.onAnswer = onAnswer;     // (questionId, answersSoFar) → void — progressive updates
    this.index = 0;
    this.answers = {};
    this.meetingNotes = '';
  }

  start() {
    this.index = 0;
    this.answers = {};
    this.meetingNotes = '';
    this.renderMeetingNotesStep();
  }

  /** Optional pre-Q1 step: paste meeting notes or import from Google Docs */
  renderMeetingNotesStep() {
    const msg = document.createElement('div');
    msg.className = 'msg assistant';
    msg.innerHTML = `
      <div class="msg-label">Imran AI · Pre-step</div>
      <div class="q-prompt">Got meeting notes or context? (Optional)</div>
      <div class="q-help">Paste call transcripts, meeting notes, or any customer context below. This helps me give better suggestions throughout the interview. You can skip this if you prefer.</div>
    `;
    this.container.appendChild(msg);

    const wrap = document.createElement('div');
    wrap.className = 'q-widget q-notes-step';

    // Textarea for paste
    const ta = document.createElement('textarea');
    ta.className = 'q-textarea q-notes-textarea';
    ta.rows = 6;
    ta.placeholder = 'Paste meeting notes, call transcripts, customer research, or any context about this customer…';
    wrap.appendChild(ta);

    // Actions: Skip + Continue
    const actions = document.createElement('div');
    actions.className = 'q-actions';

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'q-notes-skip';
    skipBtn.textContent = 'Skip →';
    skipBtn.addEventListener('click', () => {
      this.meetingNotes = '';
      wrap.querySelectorAll('textarea, button').forEach(el => el.disabled = true);
      wrap.style.opacity = '0.6';
      this.appendMessage('user', '(Skipped meeting notes)');
      this.renderQuestion();
    });

    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'q-submit';
    continueBtn.textContent = 'Use these notes →';
    continueBtn.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) {
        // If empty, treat as skip
        this.meetingNotes = '';
        this.appendMessage('user', '(No meeting notes provided)');
      } else {
        this.meetingNotes = text;
        const preview = text.length > 120 ? text.slice(0, 120) + '…' : text;
        this.appendMessage('user', `📋 Meeting notes added (${text.length} chars): ${preview}`);
      }
      wrap.querySelectorAll('textarea, button').forEach(el => el.disabled = true);
      wrap.style.opacity = '0.6';
      this.renderQuestion();
    });

    actions.appendChild(skipBtn);
    actions.appendChild(continueBtn);
    wrap.appendChild(actions);

    this.container.appendChild(wrap);
    this.container.scrollTop = this.container.scrollHeight;
    requestAnimationFrame(() => { this.container.scrollTop = this.container.scrollHeight; });
  }

  renderQuestion() {
    const q = QUESTIONS[this.index];
    if (!q) return this.finish();

    // Ask the question
    const msg = document.createElement('div');
    msg.className = 'msg assistant';
    msg.innerHTML = `
      <div class="msg-label">Imran AI · ${this.index + 1} of ${QUESTIONS.length}</div>
      <div class="q-prompt">${escapeHtml(q.prompt)}</div>
      ${q.help ? `<div class="q-help">${escapeHtml(q.help)}</div>` : ''}
    `;
    this.container.appendChild(msg);

    // Render the widget
    let widget;
    try {
      widget = this.renderWidget(q);
    } catch (err) {
      console.error('renderWidget error for question', q.id, err);
      widget = document.createElement('div');
      widget.className = 'q-widget';
      widget.innerHTML = `<div style="color:#f88;padding:8px;">Widget error: ${err.message}. Check console.</div>`;
    }
    this.container.appendChild(widget);
    this.container.scrollTop = this.container.scrollHeight;
    // Ensure scroll after DOM paint (some browsers need a tick)
    requestAnimationFrame(() => { this.container.scrollTop = this.container.scrollHeight; });
  }

  renderWidget(q) {
    const wrap = document.createElement('div');
    wrap.className = 'q-widget';

    const state = {};
    const setters = {}; // field.key → (value) => void — used by Suggest

    // Create buttons early so validate() can reference submitBtn, and
    // suggestBtn is available for the event listener below.
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'q-submit';
    submitBtn.textContent = this.index === QUESTIONS.length - 1 ? 'Generate deck →' : 'Next →';

    const suggestBtn = document.createElement('button');
    suggestBtn.type = 'button';
    suggestBtn.className = 'q-suggest';
    suggestBtn.innerHTML = '<span class="sparkle">✨</span> Suggest an answer';
    suggestBtn.title = 'Ask the AI to fill this question for you based on what it knows so far.';

    // Validate required fields — declared before renderControl calls so that
    // controls that fire onChange immediately (e.g. multiselect seeding [])
    // don't hit a temporal dead zone.
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

    // Render each field's control
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
      state[compound.key] = compound.type === 'kpi-grid' ? [{}, {}] : [{}, {}];
    }

    // Actions row: Suggest (left) + Submit (right)
    // Hide suggest button on Q1 (customer-name) and Q11 (beachheads — has per-use-case suggest)
    const hideSuggest = q.id === 'customer-name' || q.id === 'beachheads';

    const actions = document.createElement('div');
    actions.className = 'q-actions';
    if (!hideSuggest) actions.appendChild(suggestBtn);
    actions.appendChild(submitBtn);
    wrap.appendChild(actions);

    // Initial validation
    validate();

    // Suggest button — ask the LLM to fill this question
    suggestBtn.addEventListener('click', async () => {
      if (!this.onSuggest) return;
      const prev = suggestBtn.innerHTML;
      suggestBtn.disabled = true;
      suggestBtn.innerHTML = '<span class="spinner"></span>Suggesting…';
      try {
        const { values = {}, rationale } = await this.onSuggest(q.id, q, this.answers);
        console.log('[suggest] question:', q.id, 'values:', JSON.stringify(values, null, 2));
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
      // Normalize URL fields before storing
      if (state.customer_url) state.customer_url = normalizeUrl(state.customer_url);
      this.appendMessage('user', summariseAnswer(q, state));
      Object.assign(this.answers, state);
      // Fire progressive update (non-blocking)
      if (this.onAnswer) {
        this.onAnswer(q.id, { ...this.answers }).catch(err =>
          console.warn('onAnswer failed for', q.id, err)
        );
      }
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
      const MAX_KPI = 5;
      const MIN_KPI = 1;
      const g = document.createElement('div');
      g.className = 'q-kpi-grid';
      const rows = [];         // data: [{value, unit, label, framing}, ...]
      const rowEls = [];       // DOM row elements
      const inputRefs = [];    // DOM refs per row

      const rowContainer = document.createElement('div');
      rowContainer.className = 'q-kpi-rows';
      g.appendChild(rowContainer);

      // "Add KPI" button
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'q-add-uc';
      addBtn.textContent = '+ Add KPI';
      g.appendChild(addBtn);

      function buildKpiRow(framing) {
        const row = document.createElement('div');
        row.className = 'q-kpi-row';
        row.innerHTML = `
          <button type="button" class="q-kpi-toggle q-kpi-toggle--${framing.toLowerCase()}">${framing}</button>
          <input type="text" class="q-input q-kpi-value" placeholder="30" />
          <input type="text" class="q-input q-kpi-unit" placeholder="%" />
          <input type="text" class="q-input q-kpi-label" placeholder="${framing === 'Reduce' ? 'reduction in onboarding time' : 'increase in cross-sell revenue'}" />
          <button type="button" class="q-kpi-remove" title="Remove this KPI">✕</button>
        `;
        const toggleBtn = row.querySelector('.q-kpi-toggle');
        const [valEl, unitEl, labelEl] = row.querySelectorAll('input');
        const removeBtn = row.querySelector('.q-kpi-remove');
        let currentFraming = framing;

        const emit = () => {
          const idx = rowEls.indexOf(row);
          if (idx >= 0) rows[idx] = { value: valEl.value, unit: unitEl.value, label: labelEl.value, framing: currentFraming };
          onChange([...rows]);
        };

        // Toggle Reduce ↔ Improve
        toggleBtn.addEventListener('click', () => {
          currentFraming = currentFraming === 'Reduce' ? 'Improve' : 'Reduce';
          toggleBtn.textContent = currentFraming;
          toggleBtn.className = `q-kpi-toggle q-kpi-toggle--${currentFraming.toLowerCase()}`;
          labelEl.placeholder = currentFraming === 'Reduce' ? 'reduction in onboarding time' : 'increase in cross-sell revenue';
          emit();
        });

        valEl.addEventListener('input', emit);
        unitEl.addEventListener('input', emit);
        labelEl.addEventListener('input', emit);

        // Remove button
        removeBtn.addEventListener('click', () => {
          const idx = rowEls.indexOf(row);
          if (idx < 0 || rows.length <= MIN_KPI) return;
          rows.splice(idx, 1);
          inputRefs.splice(idx, 1);
          rowEls.splice(idx, 1);
          row.remove();
          updateRemoveBtns();
          updateAddBtn();
          onChange([...rows]);
        });

        return { row, valEl, unitEl, labelEl, toggleBtn, setFraming: (f) => { currentFraming = f; toggleBtn.textContent = f; toggleBtn.className = `q-kpi-toggle q-kpi-toggle--${f.toLowerCase()}`; } };
      }

      function updateRemoveBtns() {
        rowEls.forEach(el => {
          const rm = el.querySelector('.q-kpi-remove');
          if (rm) rm.style.display = rows.length <= MIN_KPI ? 'none' : '';
        });
      }

      function updateAddBtn() {
        addBtn.style.display = rows.length >= MAX_KPI ? 'none' : '';
      }

      function addKpi(framing = 'Reduce') {
        if (rows.length >= MAX_KPI) return;
        rows.push({});
        const { row, valEl, unitEl, labelEl, toggleBtn, setFraming } = buildKpiRow(framing);
        inputRefs.push({ valEl, unitEl, labelEl, toggleBtn, setFraming });
        rowEls.push(row);
        rowContainer.appendChild(row);
        updateRemoveBtns();
        updateAddBtn();
        onChange([...rows]);
      }

      addBtn.addEventListener('click', () => addKpi('Reduce'));

      // Start with 1 Reduce + 1 Improve
      addKpi('Reduce');
      addKpi('Improve');

      return {
        el: g,
        setValue: (arr) => {
          if (!Array.isArray(arr)) return;
          // Adjust row count
          while (rows.length < arr.length && rows.length < MAX_KPI) addKpi('Reduce');
          arr.slice(0, rows.length).forEach((item, i) => {
            if (!item) return;
            const refs = inputRefs[i];
            refs.valEl.value = String(item.value ?? '');
            refs.unitEl.value = String(item.unit ?? '');
            refs.labelEl.value = String(item.label ?? '');
            if (item.framing) refs.setFraming(item.framing);
            rows[i] = { value: refs.valEl.value, unit: refs.unitEl.value, label: refs.labelEl.value, framing: item.framing || 'Reduce' };
          });
          onChange([...rows]);
        },
      };
    }
    if (field.type === 'beachheads') {
      const MAX_UC = 4;
      const g = document.createElement('div');
      g.className = 'q-beachheads';
      const rows = [];         // data: [{title, ttv, before, after}, ...]
      const inputRefs = [];    // DOM refs per row: [{title: el, ttv: el, ...}, ...]
      const rowEls = [];       // DOM row elements

      const rowContainer = document.createElement('div');
      rowContainer.className = 'q-bh-rows';
      g.appendChild(rowContainer);

      // "Add use case" button
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'q-add-uc';
      addBtn.textContent = '+ Add use case';
      g.appendChild(addBtn);

      const onSuggestOne = this.onSuggest; // capture reference
      const interviewAnswers = this.answers;
      const appendMsg = this.appendMessage;

      function buildRow(idx) {
        const row = document.createElement('div');
        row.className = 'q-bh-row';
        row.innerHTML = `
          <div class="q-bh-header">
            <span>Use case ${idx + 1}</span>
            <div class="q-bh-actions">
              <button type="button" class="q-suggest-uc" title="AI suggest for this use case">✨ Suggest</button>
              <button type="button" class="q-remove-uc" title="Remove this use case">✕</button>
            </div>
          </div>
          <input type="text" class="q-input" placeholder="Name (e.g. Onboarding Copilot)" data-k="title" />
          <input type="text" class="q-input" placeholder="Time to value (e.g. 6 weeks)" data-k="ttv" />
          <textarea class="q-textarea" placeholder="Before (today's pain)" rows="2" data-k="before"></textarea>
          <textarea class="q-textarea" placeholder="After (outcome)" rows="2" data-k="after"></textarea>
        `;

        const inputs = row.querySelectorAll('[data-k]');
        const byKey = {};
        inputs.forEach((el) => byKey[el.dataset.k] = el);

        const emit = () => {
          const obj = {};
          inputs.forEach((el) => obj[el.dataset.k] = el.value);
          const actualIdx = rowEls.indexOf(row);
          if (actualIdx >= 0) rows[actualIdx] = obj;
          onChange([...rows]);
        };
        inputs.forEach((el) => el.addEventListener('input', emit));

        // Per-case suggest button
        const suggestUcBtn = row.querySelector('.q-suggest-uc');
        suggestUcBtn.addEventListener('click', async () => {
          if (!onSuggestOne) return;
          const prev = suggestUcBtn.innerHTML;
          suggestUcBtn.disabled = true;
          suggestUcBtn.innerHTML = '<span class="spinner"></span>';
          try {
            // Build a mini question schema for just one beachhead
            const singleSchema = {
              id: 'beachheads',
              fields: [{
                key: 'beachheads', type: 'beachheads', required: true,
                _singleIndex: rowEls.indexOf(row),
                _totalCount: rows.length,
              }],
            };
            const { values = {}, rationale } = await onSuggestOne('beachheads', singleSchema, interviewAnswers);
            // The AI returns { beachheads: [...] } — grab the first item for this row
            const arr = values.beachheads;
            if (Array.isArray(arr) && arr.length > 0) {
              const item = arr[0];
              if (item.name && !item.title) item.title = item.name;
              ['title', 'ttv', 'before', 'after'].forEach((k) => {
                if (byKey[k] && item[k] != null) byKey[k].value = String(item[k]);
              });
              emit();
              // Flash feedback
              row.querySelectorAll('.q-input, .q-textarea').forEach((el) => {
                el.classList.add('flash');
                setTimeout(() => el.classList.remove('flash'), 900);
              });
            }
            if (rationale) appendMsg('assistant', `✨ ${rationale}`);
          } catch (err) {
            console.error('suggest-uc failed', err);
            appendMsg('assistant', `⚠️ Couldn't suggest: ${err.userMessage || err.message}`);
          } finally {
            suggestUcBtn.disabled = false;
            suggestUcBtn.innerHTML = prev;
          }
        });

        // Remove button
        const removeBtn = row.querySelector('.q-remove-uc');
        removeBtn.addEventListener('click', () => {
          const actualIdx = rowEls.indexOf(row);
          if (actualIdx < 0 || rows.length <= 1) return;
          rows.splice(actualIdx, 1);
          inputRefs.splice(actualIdx, 1);
          rowEls.splice(actualIdx, 1);
          row.remove();
          renumberHeaders();
          updateAddBtn();
          onChange([...rows]);
        });

        return { row, byKey };
      }

      function renumberHeaders() {
        rowEls.forEach((el, i) => {
          const span = el.querySelector('.q-bh-header span');
          if (span) span.textContent = `Use case ${i + 1}`;
          // Hide remove button if only 1 row
          const rm = el.querySelector('.q-remove-uc');
          if (rm) rm.style.display = rows.length <= 1 ? 'none' : '';
        });
      }

      function updateAddBtn() {
        addBtn.style.display = rows.length >= MAX_UC ? 'none' : '';
      }

      function addUseCase() {
        const idx = rows.length;
        if (idx >= MAX_UC) return;
        rows.push({});
        const { row, byKey } = buildRow(idx);
        inputRefs.push(byKey);
        rowEls.push(row);
        rowContainer.appendChild(row);
        renumberHeaders();
        updateAddBtn();
        onChange([...rows]);
      }

      addBtn.addEventListener('click', addUseCase);

      // Start with 1 use case
      addUseCase();

      return {
        el: g,
        setValue: (arr) => {
          if (!Array.isArray(arr)) return;
          // Adjust row count to match array length
          while (rows.length < arr.length && rows.length < MAX_UC) addUseCase();
          arr.slice(0, rows.length).forEach((item, i) => {
            if (!item) return;
            const refs = inputRefs[i];
            if (item.name && !item.title) item.title = item.name;
            ['title', 'ttv', 'before', 'after'].forEach((k) => {
              if (refs[k] && item[k] != null) refs[k].value = String(item[k]);
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
    this.onComplete(this.answers, this.meetingNotes);
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

/** Normalize a URL input: company.com → https://company.com */
function normalizeUrl(input) {
  if (!input || !input.trim()) return '';
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); return url; } catch { return ''; }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
