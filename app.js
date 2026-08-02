// Interactive Customer Presentations — app shell.
//
// Boot flow:
//   1. Load sf-composer.html into an in-memory deckDoc (source of truth).
//   2. Mount deckDoc in the preview iframe via srcdoc.
//   3. Enumerate slides + render the right-hand nav.
//   4. Wait for user to click "Start interview" (or click a slide to enter edit mode).
//
// Interview → Deck generation:
//   InterviewController walks Q1–Q16 with rich widgets. On completion, we send
//   the full deckContext to the server-side Gemini backend with turn:'generate'
//   and apply the returned patches to deckDoc — one big rewrite of the reference
//   deck into the customer's deck.
//
// Slide-edit mode:
//   When a slide is scoped and the user types a message, we send turn:'edit'
//   with the current slide's HTML and apply the returned patches.

import { InterviewController } from './interview.js';
import { callLLM, applyPatches, suggestAnswer, DECK_TYPE_CONFIG } from './llm.js';

const LS = {
  sessionId: 'icp.sessionId',
};

// Label overrides applied by index — recalculated after deck-type reorder
let SLIDE_LABEL_OVERRIDES = { 0: 'Hero', 11: 'Thank You' };

const state = {
  deckDoc: null,
  slides: [],
  activeSlideIdx: null,
  scope: null,
  interview: null,
  interviewActive: false,
  answers: null,   // populated after interview completes
  busy: false,
  scrapedLogo: null, // logo URL scraped from customer website
  meetingNotes: '',   // optional meeting notes / context from user
};

document.addEventListener('DOMContentLoaded', async () => {
  ensureSessionId();
  wireTopbar();
  wireChat();
  wireNavFooter();
  try {
    await loadReferenceDeck();
  } catch (err) {
    console.error('boot_failed', err);
    document.getElementById('preview-empty').innerHTML =
      `<strong>Could not load reference deck</strong><span>${err.message}</span>`;
  }
});

function ensureSessionId() {
  if (!localStorage.getItem(LS.sessionId)) {
    localStorage.setItem(LS.sessionId, crypto.randomUUID());
  }
}

// ------------------------------------------------------------------ Deck load
async function loadReferenceDeck() {
  const res = await fetch('skill-context/sf-composer.html');
  if (!res.ok) throw new Error(`fetch composer: ${res.status}`);
  const raw = await res.text();

  const rewritten = raw
    .replace(/(href|src)="tokens\.css"/g,                  '$1="assets/tokens.css"')
    .replace(/(href|src)="components\.css"/g,              '$1="assets/components.css"')
    .replace(/(href|src)="animation\.css"/g,               '$1="assets/animation.css"')
    .replace(/(href|src)="animation-interactions\.css"/g,  '$1="assets/animation-interactions.css"')
    .replace(/(href|src)="animation\.js"/g,                '$1="assets/animation.js"');

  const parser = new DOMParser();
  const doc = parser.parseFromString(rewritten, 'text/html');

  const baseHref = new URL('.', window.location.href).href;
  const baseTag = doc.createElement('base');
  baseTag.setAttribute('href', baseHref);
  doc.head.prepend(baseTag);

  state.deckDoc = doc;
  enumerateSlides();
  renderNav();
  mountPreview();
}

function enumerateSlides() {
  const slideNodes = state.deckDoc.querySelectorAll('.slide');
  let visibleIdx = 0;
  state.slides = [];
  Array.from(slideNodes).forEach((el) => {
    // Skip hidden slides (deck type filtering)
    if (el.style.display === 'none') return;
    const dataSection = el.getAttribute('data-section') || '';
    const label = SLIDE_LABEL_OVERRIDES[visibleIdx] || dataSection || `Slide ${visibleIdx + 1}`;
    if (!el.id) el.id = `slide-${visibleIdx}`;
    state.slides.push({ id: el.id, label, dataSection, idx: visibleIdx });
    visibleIdx++;
  });
}

function renderNav() {
  const list = document.getElementById('nav-list');
  list.innerHTML = '';
  state.slides.forEach((slide) => {
    const item = document.createElement('div');
    item.className = 'nav-item';
    item.dataset.slideIdx = String(slide.idx);
    item.innerHTML = `
      <div class="idx">${slide.idx + 1}</div>
      <div class="label" title="${escapeAttr(slide.label)}">${escapeHtml(slide.label)}</div>
    `;
    item.addEventListener('click', () => selectSlide(slide.idx));
    list.appendChild(item);
  });
}

function mountPreview() {
  const iframe = document.getElementById('preview-iframe');
  const empty = document.getElementById('preview-empty');
  const html = '<!DOCTYPE html>\n' + state.deckDoc.documentElement.outerHTML;
  iframe.srcdoc = html;
  iframe.style.display = 'block';
  empty.style.display = 'none';
}

// Called after applyPatches: re-render the iframe to reflect deckDoc changes.
// Preserves the current active slide index if possible.
function rerenderPreview() {
  const iframe = document.getElementById('preview-iframe');
  const html = '<!DOCTYPE html>\n' + state.deckDoc.documentElement.outerHTML;

  // We restore the active slide once the iframe reloads.
  const restoreIdx = state.activeSlideIdx;
  iframe.addEventListener('load', function once() {
    iframe.removeEventListener('load', once);
    if (restoreIdx != null) {
      const inner = iframe.contentDocument;
      const dot = inner?.querySelectorAll('#dots .dot')[restoreIdx];
      if (dot) dot.click();
    }
  });
  iframe.srcdoc = html;
}

// ------------------------------------------------------------------ Slide select / scope
function selectSlide(idx) {
  const slide = state.slides[idx];
  if (!slide) return;
  state.activeSlideIdx = idx;
  state.scope = idx;

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.slideIdx) === idx);
  });

  const iframe = document.getElementById('preview-iframe');
  const inner = iframe.contentDocument;
  if (inner) {
    const dot = inner.querySelectorAll('#dots .dot')[idx];
    if (dot) dot.click();
  }

  document.getElementById('scope-chip-label').textContent = slide.label;
  document.getElementById('scope-chip').classList.add('visible');
  document.getElementById('chat-textarea').disabled = false;
  document.getElementById('btn-send').disabled = false;
  document.getElementById('chat-textarea').placeholder = `Refine the "${slide.label}" slide…`;
}

function clearScope() {
  state.scope = null;
  state.activeSlideIdx = null;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
  document.getElementById('scope-chip').classList.remove('visible');
  document.getElementById('chat-textarea').placeholder = 'Type a message… (⏎ to send)';
}

// ------------------------------------------------------------------ Interview
async function startInterview() {
  clearScope();
  state.interviewActive = true;
  const log = document.getElementById('chat-log');
  // Reset log to a fresh start message
  log.innerHTML = '';
  appendMessage('assistant', "Great — let's build your deck. I'll walk you through a series of questions covering customer, deck type, Bowden goal, the Gap, hero KPIs, stack, beachheads, proof, roadmap, closing, accent color, and animations.\n\nYou can also type free-form requests in the input bar at any time — for example, ask me to create an architecture diagram or rewrite specific content.");

  // Enable the input bar during interview for free-form requests
  document.getElementById('chat-textarea').disabled = false;
  document.getElementById('btn-send').disabled = false;
  document.getElementById('chat-textarea').placeholder = 'Type a free-form request… (⏎ to send)';

  state.interview = new InterviewController({
    container: log,
    appendMessage,
    onComplete: async (answers, meetingNotes) => {
      state.answers = answers;
      state.meetingNotes = meetingNotes || '';
      await generateDeck(answers);
    },
    onAnswer: async (questionId, answersSoFar) => {
      await handleProgressiveUpdate(questionId, answersSoFar);
    },
    onSuggest: async (questionId, questionSchema, answersSoFar) => {
      return await suggestAnswer({
        questionId,
        deckContext: { answers: answersSoFar, meetingNotes: state.meetingNotes || '' },
        questionSchema,
      });
    },
  });
  state.interview.start();

  // Fire tracker ping — fire-and-forget, no blocking, no reporting.
  fireTrackerEvent({ event: 'interview_start' });
}

async function generateDeck(answers) {
  setBusy(true, 'Generating deck…');
  try {
    // Force-apply accent color + cobrand BEFORE AI call (instant visual feedback)
    applyAccentAndCobrand(answers);
    rerenderPreview();

    const resp = await callLLM({
      turn: 'generate',
      userMessage: 'Generate the complete deck from the interview answers below.',
      deckContext: {
        answers,
        logoUrl: state.scrapedLogo || '',
        meetingNotes: state.meetingNotes || '',
        slides: state.slides.map((s) => ({ idx: s.idx, label: s.label, section: s.dataSection })),
      },
      model: 'sonnet',
    });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);

    // Reorder + hide slides based on deck type
    applyDeckTypeLayout(answers.deck_type);

    // Force-apply accent + cobrand again AFTER patches (safety net)
    applyAccentAndCobrand(answers);
    rerenderPreview();

    let note = resp.message || `Deck generated. ${applied.length} patches applied.`;
    if (skipped.length) note += ` (${skipped.length} skipped — will note in console.)`;
    appendMessage('assistant', note);
    if (skipped.length) console.warn('skipped patches', skipped);

    fireTrackerEvent({
      event: 'deck_new',
      customer: answers.customer,
      industry: answers.industry,
      deck_type: answers.deck_type,
      audience_type: answers.audience_type,
      products: answers.stack_sf || [],
      accent: answers.accent_hex,
    });

    appendMessage('assistant', 'Click any slide on the right to refine it — I can rewrite copy, swap the accent, tighten the hero, whatever you need.');
  } catch (err) {
    console.error(err);
    appendMessage('assistant', `⚠️ ${err.userMessage || err.message}`);
  } finally {
    setBusy(false);
  }
}

// Set all brand color CSS custom properties on deckDoc.
// Overrides --grad-evening and --sf-navy so every dark slide picks up
// the brand primary color immediately — no AI patches needed.
function applyBrandColors(answers) {
  if (!state.deckDoc || !answers.accent_hex) return;
  const root = state.deckDoc.documentElement;
  const primary = answers.accent_hex;
  const secondary = answers.secondary_hex || lightenHex(primary, 0.25);
  const tertiary = answers.tertiary_hex || lightenHex(primary, 0.45);
  const dark = darkenHex(primary, 0.3);
  const fg = contrastColor(primary);

  // Primary: used as background on dark slides
  root.style.setProperty('--accent', primary);
  root.style.setProperty('--accent-fg', fg);
  root.style.setProperty('--accent-bg-dark', dark);

  // Override the template's built-in dark backgrounds with brand primary
  root.style.setProperty('--grad-evening', `linear-gradient(180deg, ${dark} 0%, ${primary} 50%, ${secondary} 100%)`);
  root.style.setProperty('--sf-navy', primary);

  // Secondary: used for accents, badges, dots, card borders
  root.style.setProperty('--accent-secondary', secondary);
  root.style.setProperty('--accent-secondary-fg', contrastColor(secondary));
  root.style.setProperty('--sf-blue', secondary);

  // Tertiary: used for stripes, lighter tints, subtle highlights
  root.style.setProperty('--accent-l', tertiary);
  root.style.setProperty('--accent-tertiary-fg', contrastColor(tertiary));
}

// Apply brand colors + customer name to cobrand pill programmatically.
function applyAccentAndCobrand(answers) {
  if (!state.deckDoc) return;
  applyBrandColors(answers);
  if (answers.customer) {
    const pillSpan = state.deckDoc.querySelector('.cobrand-pill span');
    if (pillSpan) pillSpan.textContent = answers.customer;
  }
  if (state.scrapedLogo) {
    const pillImg = state.deckDoc.querySelector('.cobrand-pill img');
    if (pillImg) {
      // Add customer logo AFTER the Salesforce logo (or replace if it's the only one)
      const existingCustomerLogo = state.deckDoc.querySelector('.cobrand-pill .customer-logo');
      if (!existingCustomerLogo) {
        const divider = state.deckDoc.querySelector('.cobrand-pill .cobrand-divider');
        if (divider) {
          const img = state.deckDoc.createElement('img');
          img.className = 'customer-logo';
          img.src = state.scrapedLogo;
          img.width = 28;
          img.height = 28;
          img.alt = answers.customer || 'Customer';
          img.style.cssText = 'border-radius:4px;object-fit:contain;';
          divider.insertAdjacentElement('afterend', img);
        }
      } else {
        existingCustomerLogo.src = state.scrapedLogo;
      }
    }
  }
}

// ------------------------------------------------------------------ Deck type layout
// Reorder slides in deckDoc to match the deck type's slideOrder, hide unused.
function applyDeckTypeLayout(deckType) {
  const config = DECK_TYPE_CONFIG[deckType] || DECK_TYPE_CONFIG['Tell-Show-Tell'];
  const activeOrder = config.slideOrder; // e.g. ['hero','gap','why-now',...]
  const allSlideEls = Array.from(state.deckDoc.querySelectorAll('.slide'));

  // Build a map: kebab-id → DOM element
  const kebabToEl = {};
  allSlideEls.forEach((el) => {
    const ds = el.getAttribute('data-section') || '';
    if (!ds) return; // skip slides without a data-section
    const kebab = labelToKebab(ds);
    kebabToEl[kebab] = el;
  });

  // The parent container that holds slides
  const container = allSlideEls[0]?.parentElement;
  if (!container) return;

  // Show active slides and append in the correct order
  activeOrder.forEach(kebab => {
    const el = kebabToEl[kebab];
    if (el) {
      el.style.display = '';
      container.appendChild(el); // moves it to the end in new order
    }
  });

  // Hide unused slides (move them to end, hidden)
  allSlideEls.forEach(el => {
    const ds = el.getAttribute('data-section') || '';
    if (!ds) return; // skip slides without a data-section
    const kebab = labelToKebab(ds);
    if (!activeOrder.includes(kebab)) {
      el.style.display = 'none';
      container.appendChild(el);
    }
  });

  // Update label overrides: Hero is always first, Thank You is always last active
  const lastIdx = activeOrder.length - 1;
  SLIDE_LABEL_OVERRIDES = { 0: 'Hero' };
  if (activeOrder[lastIdx] === 'thank-you') {
    SLIDE_LABEL_OVERRIDES[lastIdx] = 'Thank You';
  }

  // Re-enumerate visible slides + re-render nav
  enumerateSlides();
  renderNav();

  // Refresh the iframe so its internal counter/dots match the new visible set
  rerenderPreview();
}

// Convert a slide label to kebab-case id (mirrors kebabForSlide map)
function labelToKebab(label) {
  const map = {
    'Hero': 'hero',
    'Why Now': 'why-now',
    'The Gap': 'gap',
    'How It Works': 'stack',
    'AI in Action': 'ai-in-action',
    'Real-Time Data': 'real-time',
    'Start Here': 'beachheads',
    'Where This Goes': 'scale',
    'What It Does Today': 'proof',
    'The Path Forward': 'roadmap',
    'Next Steps': 'closing',
    'Thank You': 'thank-you',
  };
  return map[label] || label.toLowerCase().replace(/\s+/g, '-');
}

// ------------------------------------------------------------------ Progressive updates
const PROGRESSIVE_MAP = {
  'customer-name': { immediate: true, action: 'cobrand' },
  'leading-statement': { slides: ['hero'] },
  'gap': { slides: ['gap'] },
  'why-now': { slides: ['why-now'] },
  'hero-kpis': { slides: ['hero'] },
  'stack': { slides: ['stack'] },
  'beachheads': { slides: ['beachheads', 'scale'] },
  'proof': { slides: ['proof'] },
  'roadmap': { slides: ['roadmap'] },
  'closing': { slides: ['closing'] },
  'accent': { immediate: true, action: 'accent' },
  'deck-type': { immediate: true, action: 'deck-layout' },
};

async function handleProgressiveUpdate(questionId, answers) {
  const mapping = PROGRESSIVE_MAP[questionId];
  if (!mapping) return;

  // Immediate updates (no AI call)
  if (mapping.immediate) {
    if (mapping.action === 'accent' && answers.accent_hex) {
      applyBrandColors(answers);
      // Instant visual feedback: tint the cobrand pill border + active dot
      const pill = state.deckDoc.querySelector('.cobrand-pill');
      if (pill) pill.style.borderBottom = `3px solid ${answers.accent_hex}`;
      const activeDot = state.deckDoc.querySelector('.dot.active');
      if (activeDot) activeDot.style.background = answers.secondary_hex || answers.accent_hex;
      rerenderPreview();
    }
    if (mapping.action === 'deck-layout' && answers.deck_type) {
      applyDeckTypeLayout(answers.deck_type);
      rerenderPreview();
    }
    if (mapping.action === 'cobrand') {
      if (answers.customer) {
        const pill = state.deckDoc.querySelector('.cobrand-pill span');
        if (pill) pill.textContent = answers.customer;
        rerenderPreview();
      }
      // Kick off background logo scrape
      if (answers.customer_url) scrapeLogoBackground(answers.customer_url);
    }
    return;
  }

  // AI-powered progressive update (fire-and-forget, no busy spinner)
  try {
    const resp = await callLLM({
      turn: 'progressive',
      questionId,
      userMessage: `Update the ${mapping.slides.join(', ')} slide(s) based on the answer to "${questionId}".`,
      deckContext: {
        answers,
        targetSlides: mapping.slides,
        meetingNotes: state.meetingNotes || '',
        slides: state.slides.map(s => ({ idx: s.idx, label: s.label, section: s.dataSection })),
      },
      model: 'haiku', // fast tier for quick incremental updates
    });
    const { applied } = applyPatches(state.deckDoc, resp.patches || []);
    if (applied.length) rerenderPreview();
  } catch (err) {
    console.warn('progressive update skipped for', questionId, err.message);
    // Non-fatal — final generate pass will catch it
  }
}

async function scrapeLogoBackground(url) {
  try {
    const res = await fetch(`/api/scrape-logo?url=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.logoUrl) {
      state.scrapedLogo = data.logoUrl;
      // If deck is loaded, apply immediately
      if (state.deckDoc) {
        const existingCustomerLogo = state.deckDoc.querySelector('.cobrand-pill .customer-logo');
        if (existingCustomerLogo) {
          existingCustomerLogo.src = data.logoUrl;
        } else {
          const divider = state.deckDoc.querySelector('.cobrand-pill .cobrand-divider');
          if (divider) {
            const img = state.deckDoc.createElement('img');
            img.className = 'customer-logo';
            img.src = data.logoUrl;
            img.width = 28;
            img.height = 28;
            img.alt = 'Customer';
            img.style.cssText = 'border-radius:4px;object-fit:contain;';
            divider.insertAdjacentElement('afterend', img);
            rerenderPreview();
          }
        }
      }
    }
  } catch (err) {
    console.warn('logo scrape failed', err.message);
  }
}

// ------------------------------------------------------------------ Slide edit
async function sendScopedEdit(text) {
  if (state.scope == null) return;
  const slide = state.slides[state.scope];
  const inner = document.getElementById('preview-iframe').contentDocument;
  const currentSlideEl = inner?.getElementById(slide.id);
  const currentHtml = currentSlideEl ? currentSlideEl.outerHTML : '';

  appendMessage('user', text);
  setBusy(true, `Refining ${slide.label}…`);
  try {
    const resp = await callLLM({
      turn: 'edit',
      slideId: kebabForSlide(slide),
      userMessage: text,
      deckContext: {
        answers: state.answers || {},
        currentSlideHtml: currentHtml,
        slideLabel: slide.label,
      },
      model: 'sonnet', // cheaper for scoped edits
    });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);
    detectAndApplyDeckTypeChange(text);
    rerenderPreview();
    appendMessage('assistant', resp.message || `Applied ${applied.length} change${applied.length === 1 ? '' : 's'}.`);
    if (skipped.length) console.warn('skipped patches', skipped);
  } catch (err) {
    console.error(err);
    appendMessage('assistant', `⚠️ ${err.userMessage || err.message}`);
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ Free-form message (during interview)
async function sendFreeformMessage(text) {
  appendMessage('user', text);
  setBusy(true, 'Working on your request…');
  try {
    const resp = await callLLM({
      turn: 'freeform',
      userMessage: text,
      deckContext: {
        answers: state.answers || {},
        meetingNotes: state.meetingNotes || '',
        slides: state.slides.map((s) => ({ idx: s.idx, label: s.label, section: s.dataSection })),
      },
      model: 'sonnet',
    });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);
    detectAndApplyDeckTypeChange(text);
    rerenderPreview();
    appendMessage('assistant', resp.message || `Applied ${applied.length} change${applied.length === 1 ? '' : 's'}.`);
    if (skipped.length) console.warn('skipped patches', skipped);
  } catch (err) {
    console.error(err);
    appendMessage('assistant', `⚠️ ${err.userMessage || err.message}`);
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ Deck-wide edit (post-generation, no slide scoped)
async function sendDeckWideEdit(text) {
  appendMessage('user', text);
  setBusy(true, 'Working on your request…');
  try {
    const resp = await callLLM({
      turn: 'freeform',
      userMessage: text,
      deckContext: {
        answers: state.answers || {},
        meetingNotes: state.meetingNotes || '',
        slides: state.slides.map((s) => ({ idx: s.idx, label: s.label, section: s.dataSection })),
      },
      model: 'sonnet',
    });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);
    detectAndApplyDeckTypeChange(text);
    rerenderPreview();
    appendMessage('assistant', resp.message || `Applied ${applied.length} change${applied.length === 1 ? '' : 's'}.`);
    if (skipped.length) console.warn('skipped patches', skipped);
  } catch (err) {
    console.error(err);
    appendMessage('assistant', `⚠️ ${err.userMessage || err.message}`);
  } finally {
    setBusy(false);
  }
}

// Detect deck-type keywords in user message and apply layout reorder
function detectAndApplyDeckTypeChange(text) {
  let newType = null;
  if (/\bpov\b|point\s*of\s*view/i.test(text)) {
    newType = 'POV (Point of View)';
  } else if (/\bproposal\b|business\s*case/i.test(text)) {
    newType = 'Proposal / Business Case';
  } else if (/tell[\s-]*show[\s-]*tell/i.test(text)) {
    newType = 'Tell-Show-Tell';
  }
  if (newType && state.answers) {
    state.answers.deck_type = newType;
    applyDeckTypeLayout(newType);
  }
}

// Map slide label → the kebab-case id the LLM/prompts use.
function kebabForSlide(slide) {
  const map = {
    'Hero': 'hero',
    'Why Now': 'why-now',
    'The Gap': 'gap',
    'How It Works': 'stack',
    'AI in Action': 'ai-in-action',
    'Real-Time Data': 'real-time',
    'Start Here': 'beachheads',
    'Where This Goes': 'scale',
    'What It Does Today': 'proof',
    'The Path Forward': 'roadmap',
    'Next Steps': 'closing',
    'Thank You': 'thank-you',
  };
  return map[slide.label] || slide.label.toLowerCase().replace(/\s+/g, '-');
}

// ------------------------------------------------------------------ Chat wiring
function wireChat() {
  const ta = document.getElementById('chat-textarea');
  const btn = document.getElementById('btn-send');

  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!btn.disabled) sendMessage();
    }
  });
  btn.addEventListener('click', sendMessage);

  document.getElementById('scope-chip-clear').addEventListener('click', clearScope);

  // File upload for logo customization
  document.getElementById('file-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      appendMessage('assistant', '⚠️ Please upload an image file (PNG, JPG, SVG, etc.).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result;
      state.scrapedLogo = dataUri;
      // Update cobrand pill with uploaded logo
      if (state.deckDoc) {
        const existingCustomerLogo = state.deckDoc.querySelector('.cobrand-pill .customer-logo');
        if (existingCustomerLogo) {
          existingCustomerLogo.src = dataUri;
        } else {
          const divider = state.deckDoc.querySelector('.cobrand-pill .cobrand-divider');
          if (divider) {
            const img = state.deckDoc.createElement('img');
            img.className = 'customer-logo';
            img.src = dataUri;
            img.width = 28;
            img.height = 28;
            img.alt = 'Customer logo';
            img.style.cssText = 'border-radius:4px;object-fit:contain;';
            divider.insertAdjacentElement('afterend', img);
          }
        }
        rerenderPreview();
      }
      appendMessage('assistant', '✅ Logo updated! The new logo is now in the deck header.');
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset so same file can be re-uploaded
  });
}

function sendMessage() {
  const ta = document.getElementById('chat-textarea');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  ta.style.height = 'auto';

  if (state.scope != null) {
    sendScopedEdit(text);
  } else if (state.interviewActive) {
    sendFreeformMessage(text);
  } else if (state.answers) {
    // Post-generation: allow deck-wide edits without scoping a slide
    sendDeckWideEdit(text);
  } else {
    appendMessage('user', text);
    appendMessage('assistant', 'Click a slide on the right first, or click Start interview to build a deck from scratch.');
  }
}

// ------------------------------------------------------------------ Chat log helpers
function appendMessage(role, text) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const label = role === 'user' ? 'You' : 'Imran AI';
  div.innerHTML = `<div class="msg-label">${label}</div>${escapeHtml(text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function setBusy(busy, label) {
  state.busy = busy;
  const btn = document.getElementById('btn-send');
  const ta = document.getElementById('chat-textarea');
  btn.disabled = busy;
  ta.disabled = busy;
  if (busy) {
    const log = document.getElementById('chat-log');
    const div = document.createElement('div');
    div.id = 'busy-msg';
    div.className = 'msg assistant';
    div.innerHTML = `<div class="msg-label">Imran AI</div><span class="spinner"></span>${escapeHtml(label || 'Working…')}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  } else {
    document.getElementById('busy-msg')?.remove();
    // Re-enable input state (respect scope or active interview)
    if (state.scope != null || state.interviewActive) {
      ta.disabled = false; btn.disabled = false;
    }
  }
}

// ------------------------------------------------------------------ Nav footer
function wireNavFooter() {
  document.getElementById('btn-start-interview').addEventListener('click', startInterview);
  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset the deck back to the blank reference?')) return;
    await loadReferenceDeck();
    state.answers = null;
    clearScope();
    document.getElementById('chat-log').innerHTML = '';
    appendMessage('assistant', 'Deck reset to the blank reference. Click Start interview to begin building it out.');
  });
}

// ------------------------------------------------------------------ Topbar
function wireTopbar() {
  document.getElementById('btn-export').addEventListener('click', () => {
    if (!state.deckDoc) return;
    const html = '<!DOCTYPE html>\n' + state.deckDoc.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const customer = state.answers?.customer;
    a.download = customer ? `deck-${slugify(customer)}.html` : 'deck.html';
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ------------------------------------------------------------------ Tracker
function fireTrackerEvent(payload) {
  fetch('/api/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      user: 'portal:' + (localStorage.getItem(LS.sessionId) || 'anon'),
      ts: new Date().toISOString(),
    }),
    keepalive: true,
  }).catch(() => {});
}

// ------------------------------------------------------------------ Utils
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
/** Returns '#fff' or '#0B0930' depending on whether the hex is dark or light */
function contrastColor(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.slice(0,2), 16);
  const g = parseInt(hex.slice(2,4), 16);
  const b = parseInt(hex.slice(4,6), 16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.5 ? '#0B0930' : '#ffffff';
}

/** Darken a hex color by a given amount (0–1) */
function darkenHex(hex, amount) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = Math.max(0, Math.round(parseInt(hex.slice(0,2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(hex.slice(2,4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(hex.slice(4,6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function lightenHex(hex, amount) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = Math.min(255, Math.round(parseInt(hex.slice(0,2), 16) + (255 - parseInt(hex.slice(0,2), 16)) * amount));
  const g = Math.min(255, Math.round(parseInt(hex.slice(2,4), 16) + (255 - parseInt(hex.slice(2,4), 16)) * amount));
  const b = Math.min(255, Math.round(parseInt(hex.slice(4,6), 16) + (255 - parseInt(hex.slice(4,6), 16)) * amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
