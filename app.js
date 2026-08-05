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
let activeAbort = null; // AbortController for the in-flight LLM call, if any

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
  activeSlideOrder: null, // current slide order (may be expanded by animations)
  pendingSlideClarification: null, // { candidates, originalText } while awaiting disambiguation reply
  editMode: null, // { pairs: [{ iframeEl, deckEl, onInput, onPaste }], imgPairs: [{ iframeEl, deckEl, onClick }] } while manual edit mode is active
  pendingImageSwap: null, // { iframeEl, deckEl } — set right before #icon-upload's file picker opens
};

// Tags that can never be a manual-edit region: non-content elements (scripts,
// form controls, embeds) and SVG, whose text/contenteditable semantics differ.
const EDITABLE_SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
  'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'SVG',
]);

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
    .replace(/(href|src)="animation\.js"/g,                '$1="assets/animation.js"')
    .replace(/(href|src)="feedback-widget\.js"/g,           '$1="assets/feedback-widget.js"');

  const parser = new DOMParser();
  const doc = parser.parseFromString(rewritten, 'text/html');

  const baseHref = new URL('.', window.location.href).href;
  const baseTag = doc.createElement('base');
  baseTag.setAttribute('href', baseHref);
  doc.head.prepend(baseTag);

  // Manual-edit-mode affordance styling. Injected once into the deck itself
  // so it survives every future mountPreview()/rerenderPreview() serialization
  // for free — no per-render wiring needed.
  const editStyle = doc.createElement('style');
  editStyle.id = 'icp-edit-mode-style';
  editStyle.textContent = `
    body.icp-edit-mode [contenteditable="true"] {
      outline: 1px dashed rgba(0,0,0,0.25);
      outline-offset: 2px;
      cursor: text;
      border-radius: 2px;
    }
    body.icp-edit-mode [contenteditable="true"]:hover {
      outline-color: var(--sf-blue, #0176D3);
    }
    body.icp-edit-mode [contenteditable="true"]:focus {
      outline: 2px solid var(--sf-blue, #0176D3);
      outline-offset: 2px;
      background: rgba(1,118,211,0.06);
    }
    body.icp-edit-mode .icp-edit-img {
      outline: 1px dashed rgba(0,0,0,0.25);
      outline-offset: 2px;
      cursor: pointer;
      border-radius: 2px;
    }
    body.icp-edit-mode .icp-edit-img:hover {
      outline-color: var(--sf-blue, #0176D3);
      background: rgba(1,118,211,0.06);
    }
  `;
  doc.head.appendChild(editStyle);

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
  const lastIdx = state.slides.length - 1;
  state.slides.forEach((slide) => {
    const pinned = slide.idx === 0 || slide.idx === lastIdx;
    const item = document.createElement('div');
    item.className = 'nav-item' + (pinned ? ' pinned' : '');
    item.dataset.slideIdx = String(slide.idx);
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-current', slide.idx === state.activeSlideIdx ? 'true' : 'false');
    item.setAttribute('aria-label', pinned ? slide.label : `${slide.label}, reorderable — use Alt+Up or Alt+Down to move`);
    item.innerHTML = `
      ${pinned ? '' : '<div class="drag-handle" title="Drag to reorder">⠿</div>'}
      <div class="idx">${slide.idx + 1}</div>
      <div class="label" title="${escapeAttr(slide.label)}">${escapeHtml(slide.label)}</div>
    `;
    item.addEventListener('click', () => selectSlide(slide.idx));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectSlide(slide.idx);
        return;
      }
      if (pinned || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !(e.altKey || e.metaKey)) return;
      e.preventDefault();
      const toIdx = slide.idx + (e.key === 'ArrowUp' ? -1 : 1);
      if (toIdx <= 0 || toIdx >= lastIdx) return;
      reorderSlide(slide.idx, toIdx);
      requestAnimationFrame(() => {
        list.querySelector(`.nav-item[data-slide-idx="${toIdx}"]`)?.focus();
      });
    });

    if (!pinned) {
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        if (state.editMode) exitEditMode();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(slide.idx));
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        list.querySelectorAll('.nav-item.drag-over').forEach((el) => el.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const fromIdx = Number(e.dataTransfer.getData('text/plain'));
        reorderSlide(fromIdx, slide.idx);
      });
    }

    list.appendChild(item);
  });
}

// Move the slide at fromIdx to toIdx among the currently visible slides.
// Hero (index 0) and Thank You (last index) are pinned and cannot be moved
// or dropped onto — mirrors SLIDE_LABEL_OVERRIDES' position-based invariant.
function reorderSlide(fromIdx, toIdx) {
  const lastIdx = state.slides.length - 1;
  if (fromIdx === toIdx) return;
  if (fromIdx <= 0 || fromIdx >= lastIdx || toIdx <= 0 || toIdx >= lastIdx) return;

  if (state.editMode) exitEditMode();

  const activeSlideId = state.activeSlideIdx != null ? state.slides[state.activeSlideIdx]?.id : null;
  const scopedSlideId = state.scope != null ? state.slides[state.scope]?.id : null;

  const slideEls = state.slides.map((s) => state.deckDoc.getElementById(s.id));
  const container = slideEls[0]?.parentElement;
  if (!container) return;

  const [moved] = slideEls.splice(fromIdx, 1);
  slideEls.splice(toIdx, 0, moved);
  slideEls.forEach((el) => container.appendChild(el));

  enumerateSlides();
  renderNav();

  if (activeSlideId) {
    const newIdx = state.slides.findIndex((s) => s.id === activeSlideId);
    if (newIdx >= 0) state.activeSlideIdx = newIdx;
  }
  state.scope = scopedSlideId ? state.slides.findIndex((s) => s.id === scopedSlideId) : null;
  if (state.scope === -1) state.scope = null;

  if (state.activeSlideIdx != null) {
    document.querySelectorAll('.nav-item').forEach((el) => {
      const isActive = Number(el.dataset.slideIdx) === state.activeSlideIdx;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  }

  rerenderPreview();
}

function mountPreview() {
  const iframe = document.getElementById('preview-iframe');
  const empty = document.getElementById('preview-empty');
  if (!state.deckDoc?.documentElement) return;
  const html = '<!DOCTYPE html>\n' + state.deckDoc.documentElement.outerHTML;
  iframe.srcdoc = html;
  iframe.style.display = 'block';
  empty.style.display = 'none';
}

// Called after applyPatches: re-render the iframe to reflect deckDoc changes.
// Preserves the current active slide index if possible.
function rerenderPreview() {
  if (state.editMode) exitEditMode(); // flush + detach before the iframe doc is torn down
  const iframe = document.getElementById('preview-iframe');
  if (!state.deckDoc?.documentElement) return;
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
    checkQueuedImageLoads(iframe.contentDocument);
  });
  iframe.srcdoc = html;
}

// Tag a deckDoc <img> for a post-render load check — the tag serializes into
// the iframe's srcdoc so we can inspect the *live* element (naturalWidth is
// meaningless on the detached deckDoc, which never actually loads images).
function queueImageLoadCheck(imgEl, label) {
  if (!imgEl) return;
  imgEl.dataset.icpLoadCheck = label;
}

// Mark every <img> an just-applied AI patch pointed `src` at, so a dead/
// blocked URL surfaces as a chat warning instead of failing silently.
function queueImageLoadChecksFromPatches(applied) {
  (applied || []).forEach((p) => {
    if (p.op !== 'set-attribute' || !/::attr\(src\)$/i.test(p.selector || '')) return;
    const img = Array.from(state.deckDoc?.querySelectorAll('img') || [])
      .find((el) => el.getAttribute('src') === p.new_html);
    queueImageLoadCheck(img, 'Image');
  });
}

// Run after the iframe (re)loads: warn in chat for any tagged <img> that
// failed to load, then clear the tags so they don't leak into future renders.
function checkQueuedImageLoads(iframeDoc) {
  if (iframeDoc) {
    iframeDoc.querySelectorAll('img[data-icp-load-check]').forEach((img) => {
      if (img.complete && img.naturalWidth === 0) {
        appendMessage('assistant', `⚠️ ${img.dataset.icpLoadCheck} failed to load — the URL may be broken, blocked, or unreachable.`);
      }
    });
  }
  state.deckDoc?.querySelectorAll('[data-icp-load-check]').forEach((el) => el.removeAttribute('data-icp-load-check'));
}

// ------------------------------------------------------------------ Manual edit mode
// Click-to-edit fallback for when the AI patch pipeline won't or can't make a
// requested copy change (e.g. a guard in applyPatches blocked it). Only leaf
// text elements become contenteditable — never whole-slide HTML — so manual
// edits can't corrupt structure the same way an unguarded AI patch could.

// True if el has at least one direct child Text node with non-whitespace content.
function hasDirectText(el) {
  return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
}

// Returns the outermost elements that carry their own direct text, skipping
// non-content tags (scripts, form controls, SVG). The deck's markup is mostly
// bespoke <div>/<span> rather than semantic tags, so eligibility is determined
// structurally instead of via a tag/class allowlist. "Outermost wins" (rather
// than innermost) so mixed-content blocks like `<h1>text<em>more</em></h1>`
// become one editable unit instead of orphaning the outer element's own text.
function leafEditableEls(container) {
  const candidates = Array.from(container.querySelectorAll('*')).filter(
    (el) => !EDITABLE_SKIP_TAGS.has(el.tagName) && !el.closest('svg') && !el.closest('[data-copyright]') && hasDirectText(el)
  );
  return candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
}

// Icon/image elements eligible for click-to-replace. Excludes app/Salesforce
// branding (marked data-brand-logo, e.g. the Thank You slide's SF logo) —
// same protection the AI patch pipeline enforces in llm.js.
function editableImgEls(container) {
  return Array.from(container.querySelectorAll('img')).filter((el) => !el.closest('[data-brand-logo]'));
}

function enterEditMode() {
  if (state.editMode || state.activeSlideIdx == null) return;
  const slide = state.slides[state.activeSlideIdx];
  if (!slide) return;

  const iframe = document.getElementById('preview-iframe');
  const inner = iframe?.contentDocument;
  if (!inner) return;

  const iframeSlideEl = inner.getElementById(slide.id);
  const deckSlideEl = state.deckDoc?.getElementById(slide.id);
  if (!iframeSlideEl || !deckSlideEl) return;

  // The iframe doc is a fresh serialization of deckDoc (mountPreview /
  // rerenderPreview), so these two lists are guaranteed the same length and
  // order — pair them positionally rather than trying to match by identity.
  const iframeEls = leafEditableEls(iframeSlideEl);
  const deckEls = leafEditableEls(deckSlideEl);

  const pairs = [];
  iframeEls.forEach((iframeEl, i) => {
    const deckEl = deckEls[i];
    if (!deckEl) return;
    iframeEl.setAttribute('contenteditable', 'true');

    const onInput = () => {
      deckEl.innerHTML = iframeEl.innerHTML;
      // Hero KPI values are cached once by playHeroCountUp() (sf-composer.html)
      // so replays don't re-parse a mid-animation number. That cache goes stale
      // the moment the user edits the value manually — clear it here so the
      // next replay re-parses the user's new text instead of reverting to it.
      if (iframeEl.closest('.hero-kpi-card')) {
        delete iframeEl.dataset.countupTarget;
        delete deckEl.dataset.countupTarget;
      }
      // Real-Time Data sync-indicator labels are snapshotted once into
      // dataset.label at slide load (sf-composer.html resetPipe()) so a
      // Play/Reset cycle can restore them after goLive() overwrites the text
      // to "Live". Refresh that snapshot on edit so Reset restores the
      // user's new label instead of the stale pre-edit one.
      if (iframeEl.classList.contains('sync-indicator')) {
        const label = iframeEl.textContent.trim();
        iframeEl.dataset.label = label;
        deckEl.dataset.label = label;
      }
      // Data Pipeline KPI targets are cached the same way as Hero's, via
      // kpiTarget() in sf-composer.html — clear on manual edit so Play/Reset
      // re-reads the user's new number instead of reverting to the old one.
      if (iframeEl.classList.contains('pipeline-kpi')) {
        delete iframeEl.dataset.countupTarget;
        delete deckEl.dataset.countupTarget;
      }
    };
    const onPaste = (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      inner.execCommand('insertText', false, text);
    };
    iframeEl.addEventListener('input', onInput);
    iframeEl.addEventListener('paste', onPaste);
    pairs.push({ iframeEl, deckEl, onInput, onPaste });
  });

  const iframeImgs = editableImgEls(iframeSlideEl);
  const deckImgs = editableImgEls(deckSlideEl);

  const imgPairs = [];
  iframeImgs.forEach((iframeEl, i) => {
    const deckEl = deckImgs[i];
    if (!deckEl) return;
    iframeEl.classList.add('icp-edit-img');
    iframeEl.title = 'Click to replace this image, or paste an image URL in chat';

    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.pendingImageSwap = { iframeEl, deckEl };
      document.getElementById('icon-upload')?.click();
    };
    iframeEl.addEventListener('click', onClick);
    imgPairs.push({ iframeEl, deckEl, onClick });
  });

  inner.body?.classList.add('icp-edit-mode');
  state.editMode = { pairs, imgPairs };

  const btn = document.getElementById('scope-chip-edit');
  if (btn) { btn.textContent = 'Done'; btn.classList.add('active'); }
}

function exitEditMode() {
  if (!state.editMode) return;
  state.editMode.pairs.forEach(({ iframeEl, onInput, onPaste }) => {
    onInput(); // final flush, in case the last keystroke's input event was superseded
    iframeEl.removeEventListener('input', onInput);
    iframeEl.removeEventListener('paste', onPaste);
    iframeEl.removeAttribute('contenteditable');
  });
  state.editMode.imgPairs.forEach(({ iframeEl, onClick }) => {
    iframeEl.removeEventListener('click', onClick);
    iframeEl.classList.remove('icp-edit-img');
    iframeEl.removeAttribute('title');
  });
  document.getElementById('preview-iframe')?.contentDocument?.body?.classList.remove('icp-edit-mode');
  state.editMode = null;
  state.pendingImageSwap = null;

  try { enforceKpiStyling(); enforceTextContrast(); } catch (_) { /* non-fatal */ }

  const btn = document.getElementById('scope-chip-edit');
  if (btn) { btn.textContent = '✎ Edit content'; btn.classList.remove('active'); }
}

// ------------------------------------------------------------------ Slide select / scope
function selectSlide(idx) {
  if (state.editMode) exitEditMode(); // flush + detach before scope moves to a different slide
  const slide = state.slides[idx];
  if (!slide) return;
  state.activeSlideIdx = idx;
  state.scope = idx;

  document.querySelectorAll('.nav-item').forEach((el) => {
    const isActive = Number(el.dataset.slideIdx) === idx;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-current', isActive ? 'true' : 'false');
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
  // Deliberately leave activeSlideIdx alone: it tracks "which slide is the
  // user currently looking at" for freeform-chat reference fallback and
  // re-render position restore, independent of the explicit scope lock.
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
  appendMessage('assistant', "Great — let's build your deck. I'll walk you through a series of questions covering customer, deck type, Bowden goal, the Gap, hero KPIs, stack, beachheads, proof, roadmap, closing, accent color, and animations.\n\nYou can also type free-form requests in the input bar at any time — for example, ask me to create an architecture diagram or rewrite specific content.\n\nNote: you may see partial previews of the deck as you go, but it won't be a complete, up-to-date version until you finish the interview and click Generate Deck.");

  // Enable the input bar during interview for free-form requests
  document.getElementById('chat-textarea').disabled = false;
  document.getElementById('btn-send').disabled = false;
  document.getElementById('chat-textarea').placeholder = 'Type a free-form request… (⏎ to send)';

  state.interview = new InterviewController({
    container: log,
    appendMessage,
    onComplete: async (answers, meetingNotes) => {
      state.interviewActive = false;
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
    onFieldChange: (questionId, fieldKey, value, answersSoFar) => {
      // Live preview: when deck_type changes, immediately apply layout
      if (fieldKey === 'deck_type' && value) {
        handleProgressiveUpdate('deck-type', answersSoFar).catch(err =>
          console.warn('live deck-type preview failed', err)
        );
      }
    },
  });
  state.interview.start();

  // Fire tracker ping — fire-and-forget, no blocking, no reporting.
  fireTrackerEvent({ event: 'interview_start' });
}

async function generateDeck(answers) {
  const controller = new AbortController();
  activeAbort = controller;
  setBusy(true, 'Generating deck…');
  try {
    // Force-apply accent color + cobrand BEFORE AI call (instant visual feedback)
    try { applyAccentAndCobrand(answers); } catch (e) { console.warn('pre-brand failed', e); }
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
    }, { signal: controller.signal, onHeartbeat: makeHeartbeatTicker('Generating deck…') });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);
    queueImageLoadChecksFromPatches(applied);

    // Reorder + hide slides based on deck type (expand for animations if selected)
    const expandedOrder = buildExpandedSlideOrder(answers);
    applyDeckTypeLayout(answers.deck_type, expandedOrder);

    // Force-apply structure + accent + cobrand + KPI sizing + text contrast AFTER patches (safety net)
    try { applyAccentAndCobrand(answers); } catch (e) { console.warn('post-brand failed', e); }
    enforceHeroStructure();
    enforceKpiStyling();
    enforceTextContrast();
    rerenderPreview();

    const note = resp.message || 'Deck generated.';
    appendMessage('assistant', note, { applied, skipped });
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

    appendMessage('assistant', 'Want changes on a specific slide? Select it on the right, then either tell me what to change in the chat box below, or click "✎ Edit content" to edit the copy and icons directly on the slide.');
    state.generatedOnce = true;
  } catch (err) {
    if (err.name === 'AbortError') {
      appendMessage('assistant', 'Cancelled.');
    } else {
      console.error(err);
      appendErrorWithRetry(`⚠️ ${err.userMessage || err.message}`, () => generateDeck(answers));
    }
  } finally {
    // Always rebuild the slide nav so the TOC stays current even after errors
    try {
      enumerateSlides();
      renderNav();
      rerenderPreview();
    } catch (_) { /* non-fatal */ }
    setBusy(false);
  }
}

// ------------------------------------------------------------------ Deck-type regeneration
// After the initial deck has been generated, switching deck type requires
// an AI pass to rewrite visible slides in the new type's voice/style.
async function regenerateForDeckType(answers) {
  const deckType = answers.deck_type || 'Tell-Show-Tell';
  // Non-blocking: show status message without disabling the input bar,
  // so the user can keep typing free-form requests during regeneration.
  appendMessage('assistant', `Adapting content for ${deckType} format…`);
  try {
    const resp = await callLLM({
      turn: 'generate',
      userMessage: `The deck type has changed to "${deckType}". Regenerate ALL visible slide content to match this deck type's narrative style and flow. Use all the interview answers below.`,
      deckContext: {
        answers,
        logoUrl: state.scrapedLogo || '',
        meetingNotes: state.meetingNotes || '',
        slides: state.slides.map(s => ({ idx: s.idx, label: s.label, section: s.dataSection })),
      },
      model: 'sonnet',
    });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);
    queueImageLoadChecksFromPatches(applied);

    // Safety net: re-apply structure + brand colors + KPI styling + text contrast after AI patches
    try { applyAccentAndCobrand(answers); } catch (e) { console.warn('retype brand failed', e); }
    enforceHeroStructure();
    enforceKpiStyling();
    enforceTextContrast();
    rerenderPreview();

    const note = resp.message || `Deck adapted for ${deckType}.`;
    appendMessage('assistant', note, { applied, skipped });
    if (skipped.length) console.warn('skipped patches during retype', skipped);
  } catch (err) {
    console.error(err);
    appendErrorWithRetry(`⚠️ Could not adapt content: ${err.userMessage || err.message}`, () => regenerateForDeckType(answers));
  }
}

// Set all brand color CSS custom properties on deckDoc.
// Overrides --grad-evening and --sf-navy so every dark slide picks up
// the brand primary color immediately — no AI patches needed.
function applyBrandColors(answers) {
  if (!state.deckDoc || !answers.accent_hex) return;
  const root = state.deckDoc.documentElement;
  if (!root) return; // guard against corrupted deckDoc
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
  root.style.setProperty('--chat-user-fg', contrastColor(secondary));

  // Tertiary: used for stripes, lighter tints, subtle highlights
  root.style.setProperty('--accent-l', tertiary);
  root.style.setProperty('--accent-tertiary-fg', contrastColor(tertiary));

  // Enforce hero structure + KPI card styling + text contrast after color changes
  enforceHeroStructure();
  enforceKpiStyling();
  enforceTextContrast();
}

// Apply brand colors + customer name to cobrand pill programmatically.
function applyAccentAndCobrand(answers) {
  if (!state.deckDoc) return;
  applyBrandColors(answers);

  const pill = state.deckDoc.querySelector('.cobrand-pill');
  if (!pill) return;
  const pillSpan = pill.querySelector('span');

  if (state.scrapedLogo) {
    // Remove ALL customer logos, then insert fresh one
    pill.querySelectorAll('.customer-logo').forEach(el => el.remove());
    const divider = pill.querySelector('.cobrand-divider');
    if (divider) {
      const img = state.deckDoc.createElement('img');
      img.className = 'customer-logo';
      img.src = state.scrapedLogo;
      img.width = 28;
      img.height = 28;
      img.alt = answers.customer || 'Customer';
      img.style.cssText = 'border-radius:4px;object-fit:contain;';
      divider.insertAdjacentElement('afterend', img);
      queueImageLoadCheck(img, 'Logo');
    }
    // Hide text span — logos are sufficient
    if (pillSpan) pillSpan.style.display = 'none';
  } else if (answers.customer && pillSpan) {
    // No logo yet — show customer name as text fallback
    pillSpan.textContent = answers.customer;
    pillSpan.style.display = '';
  }
}

// ------------------------------------------------------------------ Animated slide expansion
// Build an expanded slide order that includes animation-selected slides not in the base config.
const ANIM_KEBAB_MAP = {
  'AI in Action (typewriter chat + journey stream)': 'ai-in-action',
  'Data Pipeline (nodes + flowing packets + countUp)': 'real-time',
  'Architecture Diagram (sequential reveal + traveling packets)': 'stack',
  'CountUp Hero KPIs (recommended for all decks)': 'hero',
};

function buildExpandedSlideOrder(answers) {
  const deckType = answers.deck_type || 'Tell-Show-Tell';
  const config = DECK_TYPE_CONFIG[deckType] || DECK_TYPE_CONFIG['Tell-Show-Tell'];
  const baseOrder = [...config.slideOrder];
  const anims = answers.animations || [];
  if (!anims.length) return null; // no expansion needed

  const selected = anims.map(a => ANIM_KEBAB_MAP[a]).filter(Boolean);
  let insertIdx = baseOrder.indexOf('stack');
  if (insertIdx < 0) insertIdx = baseOrder.length - 2;

  for (const kebab of selected) {
    if (kebab === 'hero') continue; // hero countup is just an animation flag, not a new slide
    if (!baseOrder.includes(kebab)) {
      insertIdx++;
      baseOrder.splice(insertIdx, 0, kebab);
    }
  }
  return baseOrder;
}

// ------------------------------------------------------------------ Deck type layout
// Reorder slides in deckDoc to match the deck type's slideOrder, hide unused.
function applyDeckTypeLayout(deckType, overrideOrder) {
  const config = DECK_TYPE_CONFIG[deckType] || DECK_TYPE_CONFIG['Tell-Show-Tell'];
  const activeOrder = overrideOrder || config.slideOrder; // e.g. ['hero','gap','why-now',...]
  state.activeSlideOrder = activeOrder; // persist for re-enforcement after progressive patches
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

  // Reset to Hero (always slide 0) after layout change so preview
  // doesn't restore a stale activeSlideIdx from a previously clicked slide
  state.activeSlideIdx = 0;
  state.scope = null;
  document.getElementById('scope-chip').classList.remove('visible');

  // Enforce structure + text contrast for the new slide arrangement
  enforceHeroStructure();
  enforceTextContrast();

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
  // 'industry', 'audience', 'bowden-goal', 'leading-statement' intentionally
  // skipped — the AI progressive patches targeting the hero slide break KPI
  // card styling (values shrink from 32px bold to label-size text) and disrupt
  // layout. The final generate pass incorporates all of these properly.
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
  'animations': { immediate: true, action: 'animated-slides' },
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
      // Only regenerate content if the deck has already been generated once.
      // During the interview we just reorder/show/hide slides — the content
      // comes from the final generate pass.  Firing a full AI regeneration
      // with only a few answers produces garbage and corrupts slide structure.
      if (state.generatedOnce) {
        await regenerateForDeckType(answers);
      }
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
    if (mapping.action === 'animated-slides' && answers.animations?.length) {
      const deckType = answers.deck_type || 'Tell-Show-Tell';
      const expandedOrder = buildExpandedSlideOrder(answers);
      applyDeckTypeLayout(deckType, expandedOrder);
      const selected = answers.animations.map(a => ANIM_KEBAB_MAP[a]).filter(Boolean);
      const newSlides = selected.filter(k => k !== 'hero').length;
      if (newSlides > 0) {
        appendMessage('assistant', `Added ${newSlides} animated slide(s) to the deck.`);
      }
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
    queueImageLoadChecksFromPatches(applied);
    if (applied.length) {
      // Re-enforce structure + brand colors + KPI styling after AI patches
      try { applyBrandColors(answers); } catch (e) { console.warn('progressive brand failed', e); }
      enforceHeroStructure();
      enforceKpiStyling();
      enforceTextContrast();

      // Re-enforce deck-type visibility after AI patches
      // (prevents excluded slides from becoming visible or changing count)
      const deckType = answers.deck_type;
      if (deckType) {
        const config = DECK_TYPE_CONFIG[deckType] || DECK_TYPE_CONFIG['Tell-Show-Tell'];
        const activeOrder = state.activeSlideOrder || config.slideOrder;
        state.deckDoc.querySelectorAll('.slide').forEach(el => {
          const ds = el.getAttribute('data-section') || '';
          if (!ds) return;
          const kebab = labelToKebab(ds);
          if (!activeOrder.includes(kebab)) {
            el.style.display = 'none';
          }
        });
        enumerateSlides();
        renderNav();
      }
      rerenderPreview();
    }
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
      if (state.deckDoc) {
        const pill = state.deckDoc.querySelector('.cobrand-pill');
        if (pill) {
          // Remove all existing customer logos, insert fresh
          pill.querySelectorAll('.customer-logo').forEach(el => el.remove());
          const divider = pill.querySelector('.cobrand-divider');
          if (divider) {
            const img = state.deckDoc.createElement('img');
            img.className = 'customer-logo';
            img.src = data.logoUrl;
            img.width = 28;
            img.height = 28;
            img.alt = 'Customer';
            img.style.cssText = 'border-radius:4px;object-fit:contain;';
            divider.insertAdjacentElement('afterend', img);
            queueImageLoadCheck(img, 'Logo');
          }
          // Hide text span — logo is enough
          const pillSpan = pill.querySelector('span');
          if (pillSpan) pillSpan.style.display = 'none';
          rerenderPreview();
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

  if (state.editMode) exitEditMode();

  appendMessage('user', text);
  const controller = new AbortController();
  activeAbort = controller;
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
    }, { signal: controller.signal });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);
    queueImageLoadChecksFromPatches(applied);
    rerenderPreview();
    appendMessage('assistant', resp.message || `Applied ${applied.length} change${applied.length === 1 ? '' : 's'}.`, { applied, skipped });
    if (skipped.length) console.warn('skipped patches', skipped);
  } catch (err) {
    if (err.name === 'AbortError') {
      appendMessage('assistant', 'Cancelled.');
    } else {
      console.error(err);
      appendMessage('assistant', `⚠️ ${err.userMessage || err.message}`);
    }
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ Free-form deck request
// Handles any un-scoped chat message — during interview, post-generation, or
// against the freshly-loaded reference deck. The LLM sees the current slide
// list and any slide the user explicitly referenced.
async function sendFreeformRequest(text) {
  appendMessage('user', text);

  const { slides: referencedSlides, ambiguousLabels } = extractReferencedSlides(text);
  if (ambiguousLabels.length > 0) {
    state.pendingSlideClarification = { candidates: ambiguousLabels, originalText: text };
    const phrase = ambiguousLabels.map((l) => (/^the\s/i.test(l) ? l : `the ${l}`)).join(' or ');
    appendMessage('assistant', `Did you mean ${phrase} slide? Let me know which one and I'll continue.`);
    return;
  }

  await runFreeformRequest(text, referencedSlides);
}

// Resolve a reply sent while a slide-reference clarification is pending.
// If the reply names one of the candidate slides, re-run the original
// request against that slide; otherwise treat it as a normal new request.
function resolvePendingSlideClarification(replyText) {
  const pending = state.pendingSlideClarification;
  state.pendingSlideClarification = null;

  const lower = replyText.toLowerCase();
  const resolved = state.slides.find((slide) => {
    if (!pending.candidates.includes(slide.label)) return false;
    if (lower.includes(slide.label.toLowerCase())) return true;
    const aliases = SLIDE_LABEL_ALIASES[slide.label] || [];
    return aliases.some((a) => lower.includes(a));
  });

  if (resolved) {
    appendMessage('user', replyText);
    const inner = document.getElementById('preview-iframe')?.contentDocument;
    const el = inner?.getElementById(resolved.id);
    runFreeformRequest(pending.originalText, [{ label: resolved.label, html: el ? el.outerHTML : '' }]);
  } else {
    sendFreeformRequest(replyText);
  }
}

async function runFreeformRequest(text, referencedSlides) {
  const controller = new AbortController();
  activeAbort = controller;
  setBusy(true, 'Working on your request…');
  try {
    detectAndApplyDeckTypeChange(text);

    const resp = await callLLM({
      turn: 'freeform',
      userMessage: text,
      deckContext: {
        answers: state.answers || {},
        meetingNotes: state.meetingNotes || '',
        slides: state.slides.map((s) => ({ idx: s.idx, label: s.label, section: s.dataSection })),
        currentSlides: referencedSlides,
        chatHistory: getRecentChatHistory(5),
      },
      model: 'sonnet',
    }, { signal: controller.signal, onHeartbeat: makeHeartbeatTicker('Working on your request…') });

    const { applied, skipped } = applyPatches(state.deckDoc, resp.patches || []);
    queueImageLoadChecksFromPatches(applied);
    rerenderPreview();
    appendMessage('assistant', resp.message || `Applied ${applied.length} change${applied.length === 1 ? '' : 's'}.`, { applied, skipped });
    if (skipped.length) console.warn('skipped patches', skipped);
  } catch (err) {
    if (err.name === 'AbortError') {
      appendMessage('assistant', 'Cancelled.');
    } else {
      console.error(err);
      appendMessage('assistant', `⚠️ ${err.userMessage || err.message}`);
    }
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ Slide reference detection
// Natural-language synonyms for the fixed template slide labels — stable synonyms
// for each section's role, not a guess at any particular customer's content.
const SLIDE_LABEL_ALIASES = {
  'Hero': ['intro', 'opening', 'title slide', 'cover'],
  'Why Now': ['urgency', 'problem statement'],
  'The Gap': ['problem', 'pain point'],
  'How It Works': ['solution', 'product', 'demo'],
  'AI in Action': ['ai slide', 'automation'],
  'Real-Time Data': ['data slide', 'live data', 'analytics'],
  'Start Here': ['quick win', 'quick wins', 'beachhead'],
  'Where This Goes': ['vision', 'future state'],
  'What It Does Today': ['proof', 'results', 'case study'],
  'The Path Forward': ['roadmap', 'timeline', 'plan'],
  'Next Steps': ['cta', 'call to action'],
  'Thank You': ['closing', 'wrap up', 'wrap-up', 'final slide'],
};
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const REFERENCE_STOPWORDS = new Set([
  'slide', 'this', 'that', 'with', 'have', 'from', 'make', 'changes', 'change',
  'please', 'about', 'which', 'where', 'there', 'their', 'would', 'could',
  'should', 'because', 'update', 'edit', 'instead', 'something', 'little',
]);

// Parse user message to find which slide(s) they're referring to, then
// pull the live HTML from the iframe so the AI can see the current state.
function extractReferencedSlides(text) {
  const results = [];
  const inner = document.getElementById('preview-iframe')?.contentDocument;
  if (!inner || !state.slides?.length) return { slides: results, ambiguousLabels: [] };

  const seen = new Set();
  const lower = text.toLowerCase();

  const addSlide = (slide) => {
    if (!slide || seen.has(slide.id)) return;
    const el = inner.getElementById(slide.id);
    results.push({ label: slide.label, html: el ? el.outerHTML : '' });
    seen.add(slide.id);
  };

  // "slide 3" — digit references (1-based in user language)
  const slideNumMatches = lower.match(/slide\s*(\d+)/g);
  if (slideNumMatches) {
    for (const m of slideNumMatches) {
      addSlide(state.slides[parseInt(m.replace(/\D/g, ''), 10) - 1]);
    }
  }

  // "slide three" / "the third slide" — number and ordinal words
  NUMBER_WORDS.forEach((word, i) => {
    if (new RegExp(`\\bslide\\s+${word}\\b`, 'i').test(lower)) addSlide(state.slides[i]);
  });
  ORDINAL_WORDS.forEach((word, i) => {
    if (new RegExp(`\\b${word}\\s+slide\\b`, 'i').test(lower)) addSlide(state.slides[i]);
  });
  if (/\b(last|final)\s+slide\b/i.test(lower)) {
    addSlide(state.slides[state.slides.length - 1]);
  }

  // Literal label text or a known synonym (e.g. "the hero slide", "the solution slide")
  for (const slide of state.slides) {
    if (lower.includes(slide.label.toLowerCase())) { addSlide(slide); continue; }
    const aliases = SLIDE_LABEL_ALIASES[slide.label] || [];
    if (aliases.some((a) => lower.includes(a))) addSlide(slide);
  }

  // Vague references (e.g. "the pricing one") — search actual slide copy for a
  // content word from the message that appears on exactly one slide. If a word
  // matches more than one slide, remember the collision — a later, more specific
  // word may still narrow it down to exactly one.
  let ambiguousMatches = null;
  if (results.length === 0) {
    const words = [...new Set(lower.match(/[a-z]{4,}/g) || [])].filter((w) => !REFERENCE_STOPWORDS.has(w));
    for (const word of words) {
      const matches = state.slides.filter((slide) => {
        const el = inner.getElementById(slide.id);
        return (el?.textContent || '').toLowerCase().includes(word);
      });
      if (matches.length === 1) { addSlide(matches[0]); ambiguousMatches = null; break; }
      if (matches.length > 1 && !ambiguousMatches) ambiguousMatches = matches;
    }
  }

  if (results.length > 0) return { slides: results, ambiguousLabels: [] };

  // An unresolved collision means the message is genuinely ambiguous — surface
  // that instead of silently falling back to whatever slide is on screen.
  if (ambiguousMatches) {
    return { slides: results, ambiguousLabels: ambiguousMatches.map((s) => s.label) };
  }

  // Fallback: if still nothing detected, include whichever slide is
  // currently visible in the preview (the user is probably looking at it)
  if (state.activeSlideIdx != null) {
    addSlide(state.slides[state.activeSlideIdx]);
  }

  return { slides: results, ambiguousLabels: [] };
}

// Collect the last N chat messages for multi-turn context
function getRecentChatHistory(count = 5) {
  const msgs = document.querySelectorAll('#chat-log .msg');
  const recent = [];
  const arr = Array.from(msgs).slice(-(count + 1), -1); // exclude the just-appended user msg
  for (const m of arr) {
    const labelEl = m.querySelector('.msg-label');
    const role = labelEl?.textContent === 'You' ? 'user' : 'assistant';
    // Strip the role label from the text
    const text = m.textContent.replace(/^(You|Imran AI)\s*/, '').trim();
    if (text) recent.push({ role, text });
  }
  return recent;
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

  document.getElementById('btn-stop').addEventListener('click', () => {
    activeAbort?.abort();
  });

  document.getElementById('scope-chip-clear').addEventListener('click', clearScope);

  document.getElementById('scope-chip-edit').addEventListener('click', () => {
    if (state.editMode) exitEditMode();
    else enterEditMode();
  });

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
        const pill = state.deckDoc.querySelector('.cobrand-pill');
        if (pill) {
          // Remove all existing customer logos, insert fresh
          pill.querySelectorAll('.customer-logo').forEach(el => el.remove());
          const divider = pill.querySelector('.cobrand-divider');
          if (divider) {
            const img = state.deckDoc.createElement('img');
            img.className = 'customer-logo';
            img.src = dataUri;
            img.width = 28;
            img.height = 28;
            img.alt = 'Customer logo';
            img.style.cssText = 'border-radius:4px;object-fit:contain;';
            divider.insertAdjacentElement('afterend', img);
            queueImageLoadCheck(img, 'Logo');
          }
          // Hide text span — logo is enough
          const pillSpan = pill.querySelector('span');
          if (pillSpan) pillSpan.style.display = 'none';
        }
        rerenderPreview();
      }
      appendMessage('assistant', '✅ Logo updated! The new logo is now in the deck header.');
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset so same file can be re-uploaded
  });

  // File upload for click-to-replace icon/image swap (edit mode)
  document.getElementById('icon-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const swap = state.pendingImageSwap;
    state.pendingImageSwap = null;
    if (!file || !swap) { e.target.value = ''; return; }
    if (!file.type.startsWith('image/')) {
      appendMessage('assistant', '⚠️ Please upload an image file (PNG, JPG, SVG, etc.).');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result;
      swap.iframeEl.onerror = () => appendMessage('assistant', '⚠️ Image could not be loaded — the file may be corrupted.');
      swap.iframeEl.src = dataUri;
      swap.deckEl.src = dataUri;
      appendMessage('assistant', '✅ Image updated on the slide.');
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
  } else if (state.pendingSlideClarification) {
    resolvePendingSlideClarification(text);
  } else {
    sendFreeformRequest(text);
  }
}

// ------------------------------------------------------------------ Chat log helpers
const PATCH_SKIP_REASONS = {
  slide_not_found: 'target slide not found',
  selector_no_match: "selector didn't match anything on the slide",
  cobrand_logo_protected: 'blocked — logo is managed automatically',
  css_leak_blocked: 'blocked — patch contained raw CSS instead of content',
  slide_element_protected: "blocked — can't replace a whole slide container",
  root_element_protected: "blocked — can't replace document root elements",
  kpi_layout_protected: 'blocked — KPI layout is protected',
  hero_structure_protected: 'blocked — hero layout is protected',
  cobrand_protected: 'blocked — cobrand pill is protected',
  script_tag_protected: 'blocked — cannot touch wiring scripts',
  attr_op_missing_suffix: 'malformed attribute patch',
  style_op_missing_suffix: 'malformed style patch',
  copyright_protected: 'blocked — protected attribution footer',
  brand_logo_protected: 'blocked — brand logo is protected',
  unsafe_image_src: 'blocked — image URL must be http(s) or a data:image URI',
  unknown_op: 'blocked — unrecognized patch operation',
  patch_apply_error: "couldn't be applied — something about the patch didn't match the slide",
};

function renderPatchBadge(applied, skipped) {
  applied = applied || [];
  skipped = skipped || [];
  const total = applied.length + skipped.length;
  if (!total) return '';
  const ok = skipped.length === 0;
  const summary = ok
    ? `Applied ${applied.length} of ${total}`
    : `Applied ${applied.length} of ${total} — ${skipped.length} skipped`;
  let html = `<div class="patch-badge ${ok ? 'ok' : 'warn'}">${escapeHtml(summary)}</div>`;
  if (skipped.length) {
    const items = skipped.map(({ patch, reason }) => {
      const slideId = escapeHtml(patch?.slide_id || '?');
      const selector = escapeHtml(patch?.selector || '?');
      if (reason && !PATCH_SKIP_REASONS[reason]) console.warn('unrecognized patch skip reason', reason, patch);
      const reasonText = escapeHtml(PATCH_SKIP_REASONS[reason] || 'unknown reason');
      return `<li><strong>${slideId}</strong> <code>${selector}</code> — ${reasonText}</li>`;
    }).join('');
    html += `<details class="patch-details"><summary>Why were changes skipped?</summary><ul>${items}</ul></details>`;
  }
  return html;
}

function appendMessage(role, text, patchResult) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const label = role === 'user' ? 'You' : 'Imran AI';
  let html = `<div class="msg-label">${label}</div>${escapeHtml(text)}`;
  if (patchResult) html += renderPatchBadge(patchResult.applied, patchResult.skipped);
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function appendErrorWithRetry(text, onRetry) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML = `<div class="msg-label">Imran AI</div>${escapeHtml(text)}`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-retry';
  btn.textContent = 'Try again';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    onRetry();
  }, { once: true });
  div.appendChild(btn);

  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function setBusy(busy, label) {
  state.busy = busy;
  const btn = document.getElementById('btn-send');
  const ta = document.getElementById('chat-textarea');
  const stopBtn = document.getElementById('btn-stop');
  const editBtn = document.getElementById('scope-chip-edit');
  btn.disabled = busy;
  ta.disabled = busy;
  stopBtn.hidden = !busy;
  if (editBtn) editBtn.disabled = busy;
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
    activeAbort = null;
  }
}

// Updates the text of an already-shown busy message in place, without
// touching disabled state. Used to surface progress on long-running calls.
function updateBusyLabel(label) {
  const div = document.getElementById('busy-msg');
  if (!div) return;
  div.innerHTML = `<div class="msg-label">Imran AI</div><span class="spinner"></span>${escapeHtml(label)}`;
}

// Returns a heartbeat callback that escalates the busy label over time,
// so a long streaming call (deck gen can take minutes) doesn't look stalled.
function makeHeartbeatTicker(baseLabel) {
  let n = 0;
  return () => {
    n += 1; // heartbeats arrive roughly every 10s
    const suffix = n < 3 ? '' : n < 9 ? ' — still working…' : ' — this is taking longer than usual, hang tight…';
    updateBusyLabel(`${baseLabel}${suffix}`);
  };
}

// ------------------------------------------------------------------ Nav footer
function wireNavFooter() {
  document.getElementById('btn-start-interview').addEventListener('click', startInterview);
  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset the deck back to the blank reference?')) return;
    await loadReferenceDeck();
    state.answers = null;
    state.pendingSlideClarification = null;
    clearScope();
    document.getElementById('chat-log').innerHTML = '';
    appendMessage('assistant', 'Deck reset to the blank reference. Click Start interview to begin building it out.');
  });
}

// ------------------------------------------------------------------ Topbar
// Inlines stylesheets/images/scripts (currently loaded via <base>-relative
// <link>/<img>/<script> tags) so the exported file still renders once it's
// no longer served from this app's origin — e.g. opened directly from disk.
async function serializeDeckForExport() {
  const parser = new DOMParser();
  const doc = parser.parseFromString(state.deckDoc.documentElement.outerHTML, 'text/html');
  const baseHref = doc.querySelector('base')?.getAttribute('href') || window.location.href;
  const resolve = (url, from = baseHref) => new URL(url, from).href;

  const inlineStylesheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map(async link => {
    const href = link.getAttribute('href');
    if (!href) return;
    try {
      const res = await fetch(resolve(href));
      if (!res.ok) throw new Error(String(res.status));
      let css = await res.text();
      css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, path) => {
        if (/^(data:|https?:|\/\/)/.test(path)) return match;
        return `url(${quote}${resolve(path, resolve(href))}${quote})`;
      });
      const style = doc.createElement('style');
      style.textContent = css;
      link.replaceWith(style);
    } catch (err) {
      console.warn('export: failed to inline stylesheet', href, err);
    }
  });

  const inlineImages = Array.from(doc.querySelectorAll('img[src]')).map(async img => {
    const src = img.getAttribute('src');
    if (!src || /^(data:|https?:)/.test(src)) return;
    try {
      const res = await fetch(resolve(src));
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const dataUrl = await new Promise((resolveP, rejectP) => {
        const reader = new FileReader();
        reader.onload = () => resolveP(reader.result);
        reader.onerror = () => rejectP(reader.error);
        reader.readAsDataURL(blob);
      });
      img.setAttribute('src', dataUrl);
    } catch (err) {
      console.warn('export: failed to inline image', src, err);
    }
  });

  const inlineScripts = Array.from(doc.querySelectorAll('script[src]')).map(async script => {
    const src = script.getAttribute('src');
    if (!src || /^(data:|https?:)/.test(src)) return;
    try {
      const res = await fetch(resolve(src));
      if (!res.ok) throw new Error(String(res.status));
      const code = await res.text();
      const inline = doc.createElement('script');
      inline.textContent = code;
      script.replaceWith(inline);
    } catch (err) {
      console.warn('export: failed to inline script', src, err);
    }
  });

  await Promise.all([...inlineStylesheets, ...inlineImages, ...inlineScripts]);
  doc.querySelector('base')?.remove();

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

function wireTopbar() {
  const exportBtn = document.getElementById('btn-export');
  exportBtn.addEventListener('click', async () => {
    if (!state.deckDoc) return;
    const originalText = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting…';
    try {
      const html = await serializeDeckForExport();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const customer = state.answers?.customer;
      a.download = customer ? `deck-${slugify(customer)}.html` : 'deck.html';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('export failed', err);
      appendMessage('assistant', '⚠️ Something went wrong exporting the deck. Please try again.');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = originalText;
    }
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

// ------------------------------------------------------------------ KPI card styling enforcement
// Forces proper font sizes and colors on hero KPI cards.  AI patches
// frequently replace .hkc-val / .hkc-label content and lose the original
// CSS sizing (32px value vs 12px label).
function enforceKpiStyling() {
  if (!state.deckDoc) return;

  // Values: 32px bold white (the big number)
  state.deckDoc.querySelectorAll('.hkc-val').forEach(el => {
    el.style.fontSize = '32px';
    el.style.fontWeight = '700';
    el.style.color = '#fff';
    el.style.lineHeight = '1';
    el.style.marginBottom = '6px';
    el.style.letterSpacing = '-0.02em';
  });

  // Labels: 12px muted white (description below the number)
  state.deckDoc.querySelectorAll('.hkc-label').forEach(el => {
    el.style.fontSize = '12px';
    el.style.color = 'rgba(255,255,255,0.5)';
    el.style.lineHeight = '1.4';
  });

  // Unit/symbol spans inside values: accent highlight color
  state.deckDoc.querySelectorAll('.hkc-val span').forEach(el => {
    el.style.color = 'var(--sf-blue-l)';
  });
}

// ------------------------------------------------------------------ Text contrast enforcement
// Scans all visible slides and forces text to be readable against its
// background.  Dark backgrounds → light text; light backgrounds → dark text.
// Called after brand-color application, deck-type layout changes, and
// progressive AI patches so the user always sees legible slides.
function enforceTextContrast() {
  if (!state.deckDoc) return;

  const allSlides = state.deckDoc.querySelectorAll('.slide');
  allSlides.forEach(slide => {
    if (slide.style.display === 'none') return; // skip hidden slides

    // Determine if this slide (or its primary wrapper) has a dark background.
    const isDark = slideHasDarkBackground(slide);

    // HERO slide: AI patches frequently inject inline dark color styles on
    // hero text.  We must FORCE the correct color, not just clear inline
    // styles, because a cleared inline style falls back to CSS — but if the
    // AI also changed the element's class or structure, the CSS rule may no
    // longer match.
    const heroEl = slide.querySelector('.hero');
    if (heroEl) {
      if (isDark) {
        // Dark background → force white / light text
        slide.querySelectorAll('.hero h1').forEach(el => { el.style.color = '#fff'; });
        slide.querySelectorAll('.hero h1 em').forEach(el => { el.style.color = 'var(--sf-blue-l)'; });
        slide.querySelectorAll('.hero-sub').forEach(el => { el.style.color = 'rgba(255,255,255,0.65)'; });
        slide.querySelectorAll('.hero-eyebrow').forEach(el => { el.style.color = 'var(--sf-blue-l)'; });
        slide.querySelectorAll('.hero-quote p').forEach(el => { el.style.color = 'rgba(255,255,255,0.7)'; });
        slide.querySelectorAll('.hero-quote cite').forEach(el => { el.style.color = 'rgba(255,255,255,0.4)'; });
      } else {
        // Light background → force dark text
        slide.querySelectorAll('.hero h1').forEach(el => { el.style.color = 'var(--text)'; });
        slide.querySelectorAll('.hero h1 em').forEach(el => { el.style.color = 'var(--sf-blue)'; });
        slide.querySelectorAll('.hero-sub').forEach(el => { el.style.color = 'var(--muted)'; });
        slide.querySelectorAll('.hero-eyebrow').forEach(el => { el.style.color = 'var(--sf-blue)'; });
        slide.querySelectorAll('.hero-quote p').forEach(el => { el.style.color = 'var(--body)'; });
        slide.querySelectorAll('.hero-quote cite').forEach(el => { el.style.color = 'var(--muted)'; });
      }
      // KPI cards handled separately in enforceKpiStyling
      return; // hero done — skip generic rules
    }

    // THANK-YOU slide: the inner wrapper has inline grad-evening background
    const tyWrap = slide.querySelector('[style*="grad-evening"]');
    if (tyWrap) {
      if (isDark) {
        tyWrap.querySelectorAll('h2, h1').forEach(el => { el.style.color = '#fff'; });
        tyWrap.querySelectorAll('p').forEach(el => { el.style.color = 'rgba(255,255,255,0.65)'; });
      } else {
        tyWrap.querySelectorAll('h2, h1').forEach(el => { el.style.color = 'var(--text)'; });
        tyWrap.querySelectorAll('p').forEach(el => { el.style.color = 'var(--muted)'; });
      }
      return;
    }

    // CLOSING slide (Next Steps) — may also be on a dark bg
    if (slide.classList.contains('slide-closing')) {
      if (isDark) {
        slide.querySelectorAll('h2').forEach(el => { el.style.color = '#fff'; });
        slide.querySelectorAll('p').forEach(el => { el.style.color = 'rgba(255,255,255,0.65)'; });
        slide.querySelectorAll('.c-step').forEach(el => { el.style.color = '#fff'; });
      } else {
        slide.querySelectorAll('h2').forEach(el => { el.style.color = ''; });
        slide.querySelectorAll('p').forEach(el => { el.style.color = ''; });
        slide.querySelectorAll('.c-step').forEach(el => { el.style.color = ''; });
      }
      return;
    }

    // GENERIC slides (light-bg by default; they may become dark if
    // --sf-navy or a background class changes)
    const textColor = isDark ? '#fff' : '';
    const subColor = isDark ? 'rgba(255,255,255,0.65)' : '';
    const bodyColor = isDark ? 'rgba(255,255,255,0.7)' : '';

    slide.querySelectorAll('.section-title').forEach(el => { el.style.color = textColor; });
    slide.querySelectorAll('.section-sub, .eyebrow').forEach(el => { el.style.color = subColor; });
    slide.querySelectorAll('.card-title, .phase-title, .sc-title').forEach(el => { el.style.color = textColor; });
    slide.querySelectorAll('.card-body, .phase-item-desc, .sc-body').forEach(el => { el.style.color = bodyColor; });
  });
}

// ------------------------------------------------------------------ Hero structure enforcement
// Safety net that verifies the hero slide's critical DOM structure is intact
// after AI patches.  If the AI stripped CSS classes from hero children or
// removed wrapper containers, this function restores them so the design
// system's CSS rules can match.
function enforceHeroStructure() {
  if (!state.deckDoc) return;

  const heroSlide = state.deckDoc.querySelector('.slide[data-section="Hero"]');
  if (!heroSlide) return;

  // Ensure .hero wrapper exists
  let hero = heroSlide.querySelector('.hero');
  if (!hero) {
    // The entire .hero wrapper was stripped — look for the content directly
    // in the slide-body and wrap it
    const body = heroSlide.querySelector('.slide-body');
    if (!body) return;
    const innerDiv = body.querySelector('.hero-inner') || body.querySelector('div');
    if (innerDiv && !innerDiv.classList.contains('hero')) {
      innerDiv.classList.add('hero');
      hero = innerDiv;
    } else {
      return;
    }
  }

  // Ensure .hero-inner exists inside .hero
  let inner = hero.querySelector('.hero-inner');
  if (!inner) {
    // If hero-inner was stripped, wrap hero's children in it
    inner = state.deckDoc.createElement('div');
    inner.className = 'hero-inner';
    while (hero.firstChild) inner.appendChild(hero.firstChild);
    hero.appendChild(inner);
  }

  // Ensure hero-eyebrow has its class
  const eyebrow = inner.querySelector('.hero-eyebrow');
  // (eyebrow may not exist yet if deck hasn't been generated — that's fine)

  // Ensure hero-sub has its class
  // (these are structural elements the CSS depends on — if they exist
  //  without their class, the styles won't apply)

  // Ensure .hero-kpi container exists
  const kpi = inner.querySelector('.hero-kpi');
  if (kpi) {
    // Ensure each direct child div has .hero-kpi-card
    kpi.querySelectorAll(':scope > div').forEach(card => {
      if (!card.classList.contains('hero-kpi-card')) {
        card.classList.add('hero-kpi-card');
      }
    });
    // Ensure .hkc-val and .hkc-label classes exist on KPI card children
    kpi.querySelectorAll('.hero-kpi-card').forEach(card => {
      const children = Array.from(card.children);
      if (children.length >= 2) {
        if (!children[0].classList.contains('hkc-val')) {
          children[0].classList.add('hkc-val');
        }
        if (!children[1].classList.contains('hkc-label')) {
          children[1].classList.add('hkc-label');
        }
      }
    });
  }

  // Ensure the hero-quote has its class (if present)
  inner.querySelectorAll('blockquote, .hero-quote').forEach(el => {
    if (!el.classList.contains('hero-quote') && el.tagName === 'BLOCKQUOTE') {
      el.classList.add('hero-quote');
    }
  });
}

// Returns true if a slide's visual background is dark-colored.
function slideHasDarkBackground(slide) {
  // 1. Hero slide — always uses --grad-evening which is now customer-accent based
  if (slide.classList.contains('slide-hero') || slide.querySelector('.hero')) {
    return isAccentDark();
  }

  // 2. Check for inline grad-evening or sf-navy in the slide or its first child
  const inlineCheck = [slide, slide.firstElementChild].filter(Boolean);
  for (const el of inlineCheck) {
    const bg = el.style?.background || el.style?.backgroundColor || '';
    if (bg.includes('grad-evening') || bg.includes('sf-navy')) {
      return isAccentDark(); // these vars are now overridden by accent
    }
  }

  // 3. Check CSS classes
  if (slide.querySelector('.section-navy') || slide.querySelector('.section-evening')) {
    return isAccentDark();
  }

  // 4. Default: light background
  return false;
}

// After applyBrandColors, --sf-navy and --grad-evening get set to
// accent-derived values.  The "darkness" of the accent determines whether
// those slide backgrounds are dark.
function isAccentDark() {
  // Use the current CSS custom property if answers have an accent
  const root = state.deckDoc?.documentElement;
  if (!root) return true; // assume dark (safe default)
  const accentVal = root.style.getPropertyValue('--sf-navy');
  if (accentVal) {
    // Extract hex from the CSS value
    const hexMatch = accentVal.match(/#[0-9a-fA-F]{3,6}/);
    if (hexMatch) {
      const lum = luminance(hexMatch[0]);
      return lum <= 0.5;
    }
  }
  // Fallback: original --sf-navy is #001E5B which is dark
  return true;
}

function luminance(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.slice(0,2), 16);
  const g = parseInt(hex.slice(2,4), 16);
  const b = parseInt(hex.slice(4,6), 16);
  return (0.299*r + 0.587*g + 0.114*b) / 255;
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
