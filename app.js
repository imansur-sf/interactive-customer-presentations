// Interactive Customer Presentations — app shell.
//
// v1 skeleton behavior:
//   - Fetch sf-composer.html, rewrite its relative asset paths so they resolve
//     from the app root, and mount it in the preview iframe via srcdoc.
//   - Enumerate its 12 slides and render the right-hand nav.
//   - Wire click-a-slide → scroll iframe + set chat scope.
//   - Persist settings (worker URL, BYOK key) in localStorage.
//   - Chat input is stubbed for now — LLM wiring lands in a later step.

const LS = {
  workerUrl: 'icp.workerUrl',
  apiKey: 'icp.apiKey',
  sessionId: 'icp.sessionId',
};

// Human-friendly labels for slides. Slide 1 and 12 have empty data-section
// in the reference deck, so we override them here. Everything else uses
// the section string verbatim.
const SLIDE_LABEL_OVERRIDES = {
  0: 'Hero',
  11: 'Attribution',
};

// -------- State --------
const state = {
  deckDoc: null,       // parsed DOM of the current deck (source of truth)
  slides: [],          // [{ id, label, dataSection }]
  activeSlideIdx: null,
  scope: null,         // slide index when user is editing a specific slide
};

// -------- Boot --------
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

// -------- Reference deck load --------
async function loadReferenceDeck() {
  const res = await fetch('skill-context/sf-composer.html');
  if (!res.ok) throw new Error(`fetch composer: ${res.status}`);
  const raw = await res.text();

  // Rewrite composer's relative asset paths to point at the app root.
  // The composer expects tokens.css/components.css/animation.*/assets/ as
  // siblings; in our layout they're all under assets/.
  const rewritten = raw
    .replace(/(href|src)="tokens\.css"/g,                  '$1="assets/tokens.css"')
    .replace(/(href|src)="components\.css"/g,              '$1="assets/components.css"')
    .replace(/(href|src)="animation\.css"/g,               '$1="assets/animation.css"')
    .replace(/(href|src)="animation-interactions\.css"/g,  '$1="assets/animation-interactions.css"')
    .replace(/(href|src)="animation\.js"/g,                '$1="assets/animation.js"');

  // Parse into an in-memory Document — this is our source of truth going forward.
  const parser = new DOMParser();
  const doc = parser.parseFromString(rewritten, 'text/html');

  // Inject <base> so any remaining relative URLs (e.g. Google Font @import) resolve
  // against the app's origin, not the iframe's about:srcdoc pseudo-URL.
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
    // Give every slide a stable id so we can locate + patch it later.
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

  // Serialize the current deckDoc into the iframe via srcdoc — same-origin,
  // fully accessible from the parent for future DOM patching.
  const html = '<!DOCTYPE html>\n' + state.deckDoc.documentElement.outerHTML;
  iframe.srcdoc = html;
  iframe.style.display = 'block';
  empty.style.display = 'none';
}

// -------- Slide selection / scope --------
function selectSlide(idx) {
  const slide = state.slides[idx];
  if (!slide) return;

  state.activeSlideIdx = idx;
  state.scope = idx;

  // Nav highlight
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.slideIdx) === idx);
  });

  // The reference deck is a single-slide-visible carousel with its own `go(n)`
  // function scoped inside the composer's script. We trigger navigation by
  // clicking the corresponding dot — every dot is wired to `go(i)`, so this
  // reuses the composer's own state transitions instead of forking them.
  const iframe = document.getElementById('preview-iframe');
  const inner = iframe.contentDocument;
  if (inner) {
    const dot = inner.querySelectorAll('#dots .dot')[idx];
    if (dot) dot.click();
  }

  // Show scope chip + enable chat input so the user can immediately request a
  // scoped edit on this slide.
  document.getElementById('scope-chip-label').textContent = slide.label;
  document.getElementById('scope-chip').classList.add('visible');
  document.getElementById('chat-textarea').disabled = false;
  document.getElementById('btn-send').disabled = false;
}

function clearScope() {
  state.scope = null;
  state.activeSlideIdx = null;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
  document.getElementById('scope-chip').classList.remove('visible');
}

// -------- Chat (skeleton — LLM wiring comes next) --------
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
  appendMessage('user', text);
  ta.value = '';
  ta.style.height = 'auto';

  // Placeholder — LLM wiring lands in the next step.
  setTimeout(() => {
    appendMessage(
      'assistant',
      'Chat wiring lands in the next milestone — this pane will send your message to the Cloudflare Worker and apply the returned patches to the preview.'
    );
  }, 250);
}

function appendMessage(role, text) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const label = role === 'user' ? 'You' : 'Decktools';
  div.innerHTML = `<div class="msg-label">${label}</div>${escapeHtml(text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// -------- Nav footer (Start interview / Reset) --------
function wireNavFooter() {
  document.getElementById('btn-start-interview').addEventListener('click', () => {
    // Enable chat input; kick off with a starter message.
    const ta = document.getElementById('chat-textarea');
    const btn = document.getElementById('btn-send');
    ta.disabled = false;
    btn.disabled = false;
    ta.focus();
    appendMessage(
      'assistant',
      "Great — let's start. Once the LLM wiring lands, I'll ask 14 questions covering customer, deck type, Bowden goal, hero KPIs, stack, beachheads, animations, and closing CTAs. Each answer updates the preview live."
    );
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset the deck back to the blank reference?')) return;
    await loadReferenceDeck();
    clearScope();
    document.getElementById('chat-log').innerHTML = '';
    appendMessage(
      'assistant',
      'Deck reset to the blank reference. Click Start interview to begin building it out.'
    );
  });
}

// -------- Top bar (Settings + Export) --------
function wireTopbar() {
  const modal = document.getElementById('settings-modal');
  const workerInput = document.getElementById('setting-worker-url');
  const keyInput = document.getElementById('setting-api-key');

  document.getElementById('btn-settings').addEventListener('click', () => {
    workerInput.value = localStorage.getItem(LS.workerUrl) || '';
    keyInput.value = localStorage.getItem(LS.apiKey) || '';
    modal.classList.add('visible');
  });

  document.getElementById('settings-cancel').addEventListener('click', () => {
    modal.classList.remove('visible');
  });

  document.getElementById('settings-save').addEventListener('click', () => {
    const url = workerInput.value.trim();
    const key = keyInput.value.trim();
    if (url) localStorage.setItem(LS.workerUrl, url); else localStorage.removeItem(LS.workerUrl);
    if (key) localStorage.setItem(LS.apiKey, key); else localStorage.removeItem(LS.apiKey);
    modal.classList.remove('visible');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    // Basic export — serialize current deckDoc and hand back as a download.
    // The proper self-contained inliner (fonts as base64, etc.) lands in task 7.
    if (!state.deckDoc) return;
    const html = '<!DOCTYPE html>\n' + state.deckDoc.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deck.html';
    a.click();
    URL.revokeObjectURL(url);
  });
}

// -------- Helpers --------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
