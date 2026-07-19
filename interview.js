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
  constructor({ container, onComplete, appendMessage }) {
    this.container = container;   // the chat log element
    this.onComplete = onComplete; // called with the collected deckContext
    this.appendMessage = appendMessage;
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
    const submitBtn = document.createElement('button');
    submitBtn.className = 'q-submit';
    submitBtn.textContent = this.index === QUESTIONS.length - 1 ? 'Generate deck →' : 'Next →';

    q.fields.forEach((field) => {
      const fieldEl = document.createElement('div');
      fieldEl.className = 'q-field';
      if (field.label) {
        const lbl = document.createElement('div');
        lbl.className = 'q-field-label';
        lbl.textContent = field.label + (field.required ? ' *' : '');
        fieldEl.appendChild(lbl);
      }

      const control = this.renderControl(field, (val) => { state[field.key] = val; validate(); });
      fieldEl.appendChild(control);
      wrap.appendChild(fieldEl);
    });

    // Compound widgets (kpi-grid, beachheads) manage their own field.key
    const compound = q.fields.find((f) => f.type === 'kpi-grid' || f.type === 'beachheads');
    if (compound) {
      state[compound.key] = compound.type === 'kpi-grid'
        ? [{}, {}, {}, {}]
        : [{}, {}];
    }

    // Validate before enabling submit
    const validate = () => {
      let ok = true;
      for (const f of q.fields) {
        if (!f.required) continue;
        const v = state[f.key];
        if (v == null) { ok = false; break; }
        if (typeof v === 'string' && !v.trim()) { ok = false; break; }
        if (Array.isArray(v)) {
          if (v.length === 0) { ok = false; break; }
          if (f.type === 'kpi-grid') {
            if (!v.every((r) => r.value && r.label)) { ok = false; break; }
          }
          if (f.type === 'beachheads') {
            if (!v.every((r) => r.title && r.before && r.after)) { ok = false; break; }
          }
        }
      }
      submitBtn.disabled = !ok;
    };
    validate();

    submitBtn.addEventListener('click', () => {
      // Echo the answer as a user message (compact rendering)
      this.appendMessage('user', summariseAnswer(q, state));
      // Store and advance
      Object.assign(this.answers, state);
      // Freeze this widget
      wrap.querySelectorAll('input, textarea, button').forEach((el) => el.disabled = true);
      wrap.style.opacity = '0.6';

      this.index++;
      this.renderQuestion();
    });

    wrap.appendChild(submitBtn);
    return wrap;
  }

  renderControl(field, onChange) {
    if (field.type === 'text' || field.type === 'hex') {
      const input = document.createElement('input');
      input.type = field.type === 'hex' ? 'text' : 'text';
      input.placeholder = field.placeholder || '';
      input.className = 'q-input';
      input.addEventListener('input', () => onChange(input.value));
      return input;
    }
    if (field.type === 'textarea') {
      const t = document.createElement('textarea');
      t.rows = field.rows || 3;
      t.placeholder = field.placeholder || '';
      t.className = 'q-textarea';
      t.addEventListener('input', () => onChange(t.value));
      return t;
    }
    if (field.type === 'radio') {
      const g = document.createElement('div');
      g.className = 'q-chips';
      field.options.forEach((opt) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'q-chip';
        chip.textContent = opt;
        chip.addEventListener('click', () => {
          g.querySelectorAll('.q-chip').forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
          onChange(opt);
        });
        g.appendChild(chip);
      });
      return g;
    }
    if (field.type === 'multiselect') {
      const g = document.createElement('div');
      g.className = 'q-chips';
      const selected = new Set();
      field.options.forEach((opt) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'q-chip';
        chip.textContent = opt;
        chip.addEventListener('click', () => {
          if (selected.has(opt)) { selected.delete(opt); chip.classList.remove('selected'); }
          else { selected.add(opt); chip.classList.add('selected'); }
          onChange(Array.from(selected));
        });
        g.appendChild(chip);
      });
      onChange([]); // initial empty
      return g;
    }
    if (field.type === 'kpi-grid') {
      const g = document.createElement('div');
      g.className = 'q-kpi-grid';
      const rows = [{}, {}, {}, {}];
      const framings = ['Reduce', 'Reduce', 'Improve', 'Improve'];
      rows.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'q-kpi-row';
        row.innerHTML = `
          <div class="q-kpi-tag">${framings[i]}</div>
          <input type="text" class="q-input q-kpi-value" placeholder="30" />
          <input type="text" class="q-input q-kpi-unit" placeholder="%" />
          <input type="text" class="q-input q-kpi-label" placeholder="reduction in onboarding time" />
        `;
        const [valEl, unitEl, labelEl] = row.querySelectorAll('input');
        const emit = () => {
          rows[i] = { value: valEl.value, unit: unitEl.value, label: labelEl.value, framing: framings[i] };
          onChange([...rows]);
        };
        valEl.addEventListener('input', emit);
        unitEl.addEventListener('input', emit);
        labelEl.addEventListener('input', emit);
        g.appendChild(row);
      });
      return g;
    }
    if (field.type === 'beachheads') {
      const g = document.createElement('div');
      g.className = 'q-beachheads';
      const rows = [{}, {}];
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
        const emit = () => {
          const obj = {};
          inputs.forEach((el) => obj[el.dataset.k] = el.value);
          rows[i] = obj;
          onChange([...rows]);
        };
        inputs.forEach((el) => el.addEventListener('input', emit));
        g.appendChild(row);
      });
      return g;
    }
    // Fallback
    const span = document.createElement('span');
    span.textContent = `[unsupported: ${field.type}]`;
    return span;
  }

  finish() {
    this.appendMessage('assistant', "Perfect — I've got everything I need. Generating the deck now…");
    this.onComplete(this.answers);
  }
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
