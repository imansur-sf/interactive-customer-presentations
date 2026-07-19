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
//   the full deckContext to /decktools/llm with turn:'generate' and apply the
//   returned patches to deckDoc — one big rewrite of the reference deck into
//   the customer's deck.
//
// Slide-edit mode:
//   When a slide is scoped and the user types a message, we send turn:'edit'
//   with the current slide's HTML and apply the returned patches.

import { InterviewController } from './interview.js';
import { callLLM, applyPatches, getWorkerUrl, suggestAnswer, detectRoute } from './llm.js';

const LS = {
  workerUrl: 'icp.workerUrl',
  apiKey: 'icp.apiKey',
  sessionId: 'icp.sessionId',
};

const SLIDE_LABEL_OVERRIDES = { 0: 'Hero', 11: 'Attribution' };

const state = {
  deckDoc: null,
  slides: [],
  activeSlideIdx: null,
  scope: null,
  interview: null,
  answers: null,   // populated after interview completes
  busy: false,
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
  state.slides = Array.from(slideNodes).map((el, i) => {
    const dataSection = el.getAttribute('data-section') || '';
    const label = SLIDE_LABEL_OVERRIDES[i] || dataSection || `Slide ${i + 1}`;
    if (!el.id) el.id = `slide-${i}`;
    return { id: el.id, label, dataSection, idx: i };
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
function startInterview() {
  clearScope();
  const log = document.getElementById('chat-log');
  // Reset log to a fresh start message
  log.innerHTML = '';
  appendMessage('assistant', "Great — let's build your deck. I'll ask 16 questions covering customer, deck type, Bowden goal, the Gap, hero KPIs, stack, beachheads, proof, roadmap, closing, accent color, and animations. Answer each one below.");

  state.interview = new InterviewController({
    container: log,
    appendMessage,
    onComplete: async (answers) => {
      state.answers = answers;
      await generateDeck(answers);
    },
    onSuggest: async (questionId, questionSchema, answersSoFar) => {
      return await suggestAnswer({
        questionId,
        deckContext: { answers: answersSoFar },
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
    const resp = await callLLM({
      turn: 'generate',
      userMessage: 'Generate the complete deck from the interview answers below.',
      deckContext: {
        answers,
        // Send the current (blank/reference) deck slide ids so the model knows
        // the target slot structure it's patching against.
        slides: state.slides.map((s) => ({ idx: s.idx, label: s.label, section: s.dataSection })),
      },
      model: 'opus',
    });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);
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
    'Attribution': 'attribution',
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
}

function sendMessage() {
  const ta = document.getElementById('chat-textarea');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  ta.style.height = 'auto';

  if (state.scope != null) {
    sendScopedEdit(text);
  } else {
    appendMessage('user', text);
    appendMessage('assistant', 'Click a slide on the right first, then I can apply the edit there. Or click Start interview to build a deck from scratch.');
  }
}

// ------------------------------------------------------------------ Chat log helpers
function appendMessage(role, text) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const label = role === 'user' ? 'You' : 'Decktools';
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
    div.innerHTML = `<div class="msg-label">Decktools</div><span class="spinner"></span>${escapeHtml(label || 'Working…')}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  } else {
    document.getElementById('busy-msg')?.remove();
    // Re-enable input state (respect scope)
    if (state.scope != null) {
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
  const modal = document.getElementById('settings-modal');
  const workerInput = document.getElementById('setting-worker-url');
  const keyInput = document.getElementById('setting-api-key');

  document.getElementById('btn-settings').addEventListener('click', () => {
    workerInput.value = localStorage.getItem(LS.workerUrl) || '';
    keyInput.value = localStorage.getItem(LS.apiKey) || '';
    modal.classList.add('visible');
  });
  document.getElementById('settings-cancel').addEventListener('click', () => modal.classList.remove('visible'));
  document.getElementById('settings-save').addEventListener('click', () => {
    const url = workerInput.value.trim();
    const key = keyInput.value.trim();
    if (url) localStorage.setItem(LS.workerUrl, url); else localStorage.removeItem(LS.workerUrl);
    if (key) localStorage.setItem(LS.apiKey, key); else localStorage.removeItem(LS.apiKey);
    modal.classList.remove('visible');
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });

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
  const workerUrl = getWorkerUrlSafe();
  if (!workerUrl) return;
  const url = workerUrl.replace(/\/+$/, '') + '/decktools/track';
  fetch(url, {
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
function getWorkerUrlSafe() { return (localStorage.getItem(LS.workerUrl) || '').trim(); }

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
