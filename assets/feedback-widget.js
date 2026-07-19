/*!
 * Decktools Feedback Widget v1.1
 * Drop <script src="feedback-widget.js"></script> into any decktools deck.
 * Requires data-feedback-repo on <html> tag.
 * Presenter mode: P button in slide-controls nav bar.
 */
(function () {
  'use strict';

  if (new URLSearchParams(location.search).has('present')) return;

  // ── Config — read from <html> attributes ──────────────────────────────
  const htmlEl = document.documentElement;
  const FEEDBACK_REPO  = htmlEl.dataset.feedbackRepo  || '';   // e.g. "mtoolin/deck-westpac"
  const TRACKER_URL    = htmlEl.dataset.trackerUrl    || 'https://decktools-tracker.mtoolin.workers.dev/track';
  const FEEDBACK_PROXY = 'https://decktools-tracker.mtoolin.workers.dev/feedback';
  const STORAGE_KEY    = 'dt_reviewer_name';
  const SESSION_KEY    = 'dt_feedback_session';

  let reviewerName  = localStorage.getItem(STORAGE_KEY) || '';
  let presenterMode = false;
  let currentSlide  = 1;
  let currentSection = '';
  let deckName = htmlEl.dataset.deckName || location.pathname.split('/').pop() || 'deck.html';
  let feedbackSha = null;   // GitHub blob SHA — needed for updates

  // comments: { [slideKey]: [{name, ts, text}] }
  let comments = (() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || {}; } catch { return {}; }
  })();

  function saveSession() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(comments));
  }

  function slideKey(n) { return `slide-${n}`; }

  function ping(payload) {
    if (!TRACKER_URL) return;
    payload.ts = new Date().toISOString();
    payload.deck = deckName;
    fetch(TRACKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  // ── Slide tracking ─────────────────────────────────────────────────────
  function watchSlides() {
    function readActive() {
      const slides = Array.from(document.querySelectorAll('.slide-deck .slide'));
      const idx = slides.findIndex(s => s.classList.contains('active'));
      if (idx === -1) return;
      currentSlide = idx + 1;
      currentSection = slides[idx].dataset.section || '';
      updateSlideLabel();
      renderThread();
    }
    const observer = new MutationObserver(readActive);
    document.querySelectorAll('.slide-deck .slide').forEach(s => {
      observer.observe(s, { attributes: true, attributeFilter: ['class'] });
    });
    readActive();
  }

  // ── Feedback proxy ─────────────────────────────────────────────────────
  async function commitFeedback() {
    if (!FEEDBACK_REPO) return 'clipboard';

    const md = buildMarkdown();
    const content = btoa(unescape(encodeURIComponent(md)));

    try {
      const body = { repo: FEEDBACK_REPO, deck: deckName, content };
      if (feedbackSha) body.sha = feedbackSha;

      const res = await fetch(FEEDBACK_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (data.ok) {
        feedbackSha = data.sha;
        return true;
      }
      return 'clipboard';
    } catch {
      return 'clipboard';
    }
  }

  async function saveFeedback() {
    const result = await commitFeedback();
    if (result === 'clipboard') {
      try { await navigator.clipboard.writeText(buildMarkdown()); return 'clipboard'; } catch { return false; }
    }
    return result;
  }

  // ── Markdown builder ───────────────────────────────────────────────────
  function buildMarkdown() {
    const totalComments = Object.values(comments).reduce((n, arr) => n + arr.length, 0);
    const slidesWithComments = Object.keys(comments).filter(k => comments[k].length > 0).length;
    const allSlides = Array.from(document.querySelectorAll('.slide-deck .slide'));
    const now = new Date().toLocaleString();

    let md = `# Deck Review — ${deckName}\n`;
    md += `**Date:** ${now}  \n`;
    md += `**Slides reviewed:** ${allSlides.length}  \n`;
    md += `**Total comments:** ${totalComments}  \n`;
    md += `**Slides with comments:** ${slidesWithComments}\n\n---\n\n`;

    allSlides.forEach((slide, i) => {
      const key = slideKey(i + 1);
      const thread = comments[key];
      if (!thread || thread.length === 0) return;
      const section = slide.dataset.section || '';
      const heading = section ? `Slide ${i + 1} — ${section}` : `Slide ${i + 1}`;
      md += `## ${heading}\n\n`;
      thread.forEach(c => { md += `**${c.name}** (${c.ts}): ${c.text}  \n`; });
      md += '\n';
    });

    if (totalComments === 0) md += '_No comments recorded._\n';
    return md;
  }

  // ── Inject CSS ─────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #dt-fab {
      position: fixed;
      bottom: 20px;
      left: 24px;
      z-index: 9999;
      font-family: var(--font-body, 'Salesforce Sans', system-ui, sans-serif);
    }
    #dt-fab-btn {
      width: 30px; height: 30px;
      border-radius: 50%;
      background: var(--sf-blue, #022AC0);
      color: #fff;
      border: none;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.15s, background 0.15s;
    }
    #dt-fab-btn:hover { background: var(--sf-blue-m, #066AFE); transform: scale(1.08); }
    #dt-fab-btn svg { width: 13px; height: 13px; }
    #dt-panel {
      display: none;
      position: absolute;
      bottom: 38px;
      left: 0;
      width: 300px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      overflow: hidden;
    }
    #dt-panel.open { display: flex; flex-direction: column; }
    #dt-panel-header {
      background: var(--sf-navy, #001E5B);
      color: #fff;
      padding: 10px 14px;
      font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
      display: flex; align-items: center; justify-content: space-between;
    }
    #dt-slide-label { font-size: 11px; font-weight: 600; color: var(--sf-blue-l, #00B3FF); letter-spacing: 0.03em; }
    #dt-thread {
      max-height: 220px; overflow-y: auto;
      padding: 10px 14px 0;
      display: flex; flex-direction: column; gap: 8px;
    }
    .dt-comment { background: var(--off-white, #EAF5FE); border-radius: 8px; padding: 8px 10px; font-size: 12px; line-height: 1.5; }
    .dt-comment-meta { font-weight: 700; color: var(--sf-blue, #022AC0); margin-bottom: 2px; font-size: 11px; }
    .dt-comment-text { color: #1a1a1a; }
    .dt-empty { font-size: 12px; color: var(--muted, #6B7280); text-align: center; padding: 10px 0 4px; font-style: italic; }
    #dt-input-area { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 6px; }
    #dt-name-input {
      width: 100%; padding: 6px 10px;
      border: 1.5px solid var(--gray-200, #E5E7EB); border-radius: 6px;
      font-size: 12px; font-family: inherit; outline: none; box-sizing: border-box;
    }
    #dt-name-input:focus { border-color: var(--sf-blue-m, #066AFE); }
    #dt-comment-input {
      width: 100%; padding: 7px 10px;
      border: 1.5px solid var(--gray-200, #E5E7EB); border-radius: 6px;
      font-size: 12px; font-family: inherit; resize: vertical; min-height: 60px;
      outline: none; box-sizing: border-box;
    }
    #dt-comment-input:focus { border-color: var(--sf-blue-m, #066AFE); }
    #dt-actions { display: flex; gap: 6px; align-items: center; }
    #dt-submit-btn {
      flex: 1; padding: 7px 0;
      background: var(--sf-blue, #022AC0); color: #fff;
      border: none; border-radius: 6px;
      font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit;
      transition: background 0.15s;
    }
    #dt-submit-btn:hover { background: var(--sf-blue-m, #066AFE); }
    #dt-end-btn {
      padding: 7px 10px;
      background: transparent; color: var(--muted, #6B7280);
      border: 1.5px solid var(--gray-200, #E5E7EB); border-radius: 6px;
      font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
      white-space: nowrap; transition: border-color 0.15s, color 0.15s;
    }
    #dt-end-btn:hover { border-color: var(--sf-blue, #022AC0); color: var(--sf-blue, #022AC0); }
    #dt-status { font-size: 11px; color: var(--muted, #6B7280); text-align: center; min-height: 16px; padding: 0 14px 8px; }
    #dt-present-btn {
      width: 30px; height: 30px;
      border-radius: 50%;
      border: 1px solid var(--gray-200, #E5E7EB);
      background: var(--white, #fff);
      color: var(--sf-navy, #001E5B);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      box-shadow: var(--shadow-card, 0 1px 4px rgba(0,0,0,0.08));
    }
    #dt-present-btn:hover { background: var(--sf-navy, #001E5B); color: #fff; border-color: var(--sf-navy, #001E5B); }
    #dt-present-btn.active { background: var(--sf-navy, #001E5B); color: #fff; border-color: var(--sf-navy, #001E5B); }
    .dt-hidden { display: none !important; }
  `;
  document.head.appendChild(style);

  // ── Build DOM ──────────────────────────────────────────────────────────
  const fab = document.createElement('div');
  fab.id = 'dt-fab';
  fab.innerHTML = `
    <div id="dt-panel">
      <div id="dt-panel-header">
        <span>Review</span>
        <span id="dt-slide-label">Slide 1</span>
      </div>
      <div id="dt-thread"></div>
      <div id="dt-input-area">
        <input id="dt-name-input" type="text" placeholder="Your name" maxlength="40" />
        <textarea id="dt-comment-input" placeholder="Describe what you'd like to change on this slide…"></textarea>
        <div id="dt-actions">
          <button id="dt-submit-btn">Add comment</button>
          <button id="dt-end-btn">End Review</button>
        </div>
      </div>
      <div id="dt-status"></div>
    </div>
    <button id="dt-fab-btn" title="Leave feedback on this slide">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  `;

  const presentBtn = document.createElement('button');
  presentBtn.id = 'dt-present-btn';
  presentBtn.title = 'Presenter mode — hides review widget';
  (function() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    const screen = document.createElementNS(ns, 'rect');
    screen.setAttribute('x','2'); screen.setAttribute('y','3');
    screen.setAttribute('width','20'); screen.setAttribute('height','14'); screen.setAttribute('rx','2');
    const stand = document.createElementNS(ns, 'path');
    stand.setAttribute('d', 'M8 21h8M12 17v4');
    const play = document.createElementNS(ns, 'polygon');
    play.setAttribute('points', '10,8 10,14 15,11');
    play.setAttribute('fill', 'currentColor'); play.setAttribute('stroke', 'none');
    svg.appendChild(screen); svg.appendChild(stand); svg.appendChild(play);
    presentBtn.appendChild(svg);
  })();

  document.body.appendChild(fab);

  // ── Inject P button into .slide-controls ──────────────────────────────
  function injectPresentBtn() {
    const controls = document.querySelector('.slide-controls');
    if (controls) {
      controls.insertBefore(presentBtn, controls.firstChild);
    } else {
      // Fallback for decks without .slide-controls
      presentBtn.style.cssText = 'position:fixed;bottom:28px;left:calc(50% - 120px);z-index:9999;';
      document.body.appendChild(presentBtn);
    }
  }

  // ── References ─────────────────────────────────────────────────────────
  const panel        = document.getElementById('dt-panel');
  const fabBtn       = document.getElementById('dt-fab-btn');
  const thread       = document.getElementById('dt-thread');
  const nameInput    = document.getElementById('dt-name-input');
  const commentInput = document.getElementById('dt-comment-input');
  const submitBtn    = document.getElementById('dt-submit-btn');
  const endBtn       = document.getElementById('dt-end-btn');
  const statusEl     = document.getElementById('dt-status');
  const slideLabel   = document.getElementById('dt-slide-label');

  if (reviewerName) nameInput.value = reviewerName;

  // ── UI helpers ─────────────────────────────────────────────────────────
  function updateSlideLabel() {
    slideLabel.textContent = currentSection
      ? `Slide ${currentSlide} · ${currentSection}`
      : `Slide ${currentSlide}`;
  }

  function renderThread() {
    const threadComments = comments[slideKey(currentSlide)] || [];
    if (threadComments.length === 0) {
      thread.innerHTML = '<div class="dt-empty">No comments on this slide yet.</div>';
    } else {
      thread.innerHTML = threadComments.map(c => `
        <div class="dt-comment">
          <div class="dt-comment-meta">${esc(c.name)} · ${esc(c.ts)}</div>
          <div class="dt-comment-text">${esc(c.text)}</div>
        </div>
      `).join('');
      thread.scrollTop = thread.scrollHeight;
    }
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setStatus(msg, duration) {
    statusEl.textContent = msg;
    if (duration) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, duration);
  }

  // ── Panel toggle ───────────────────────────────────────────────────────
  fabBtn.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    if (isOpen) { renderThread(); commentInput.focus(); }
  });

  document.addEventListener('click', e => {
    if (!fab.contains(e.target) && e.target !== presentBtn) {
      panel.classList.remove('open');
    }
  });

  // ── Submit comment ─────────────────────────────────────────────────────
  submitBtn.addEventListener('click', submitComment);
  commentInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment();
  });

  async function submitComment() {
    const name = nameInput.value.trim();
    const text = commentInput.value.trim();
    if (!name) { nameInput.focus(); nameInput.style.borderColor = '#B60554'; return; }
    nameInput.style.borderColor = '';
    if (!text) { commentInput.focus(); return; }

    reviewerName = name;
    localStorage.setItem(STORAGE_KEY, name);

    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const key = slideKey(currentSlide);
    if (!comments[key]) comments[key] = [];
    comments[key].push({ name, ts, text });
    saveSession();
    commentInput.value = '';
    renderThread();

    if (FEEDBACK_REPO) {
      setStatus('Saving…');
      const result = await saveFeedback();
      setStatus(result === true ? 'Saved to GitHub' : 'Saved (clipboard fallback)', 2000);
    }
  }

  // ── End Review ─────────────────────────────────────────────────────────
  endBtn.addEventListener('click', async () => {
    const total = Object.values(comments).reduce((n, a) => n + a.length, 0);
    if (total === 0) { setStatus('No comments to save.', 2500); return; }

    setStatus('Saving final review…');
    const result = await saveFeedback();
    const slides = Object.keys(comments).filter(k => comments[k].length > 0).length;

    if (result === true) {
      ping({ event: 'review_end', comments: total, slides_with_comments: slides });
      setStatus(`Review saved to GitHub — ${total} comment${total !== 1 ? 's' : ''} across ${slides} slide${slides !== 1 ? 's' : ''}.`);
    } else if (result === 'clipboard') {
      setStatus(`Copied to clipboard — ${total} comments. Paste into Claude.`);
    } else {
      setStatus('Could not save. Try again.', 3000);
    }
  });

  // ── Auto-save on unload ────────────────────────────────────────────────
  window.addEventListener('beforeunload', (e) => {
    const total = Object.values(comments).reduce((n, a) => n + a.length, 0);
    if (total === 0) return;
    if (FEEDBACK_REPO) {
      saveFeedback(); // best-effort auto-save via proxy
    } else {
      // No GitHub integration — warn before losing unsaved comments
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ── Presenter mode ─────────────────────────────────────────────────────
  presentBtn.addEventListener('click', () => {
    presenterMode = !presenterMode;
    presentBtn.classList.toggle('active', presenterMode);
    presentBtn.title = presenterMode ? 'Exit presenter mode' : 'Presenter mode — hides review widget';
    fab.classList.toggle('dt-hidden', presenterMode);
    panel.classList.remove('open');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') panel.classList.remove('open');
  });

  // ── Share button ───────────────────────────────────────────────────────
  function injectShareBtn() {
    const controls = document.querySelector('.slide-controls');
    if (!controls) return;
    const shareBtn = document.createElement('button');
    shareBtn.id = 'dt-share-btn';
    shareBtn.title = 'Copy shareable link';
    shareBtn.style.cssText = 'width:30px;height:30px;border-radius:50%;border:1px solid var(--gray-200,#E5E7EB);background:var(--white,#fff);color:var(--sf-navy,#001E5B);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s,color 0.15s;box-shadow:0 1px 4px rgba(0,0,0,0.08);margin-left:4px;flex-shrink:0;';
    shareBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
    shareBtn.addEventListener('mouseover', () => { shareBtn.style.background = 'var(--sf-navy,#001E5B)'; shareBtn.style.color = '#fff'; });
    shareBtn.addEventListener('mouseout',  () => { shareBtn.style.background = 'var(--white,#fff)';      shareBtn.style.color = 'var(--sf-navy,#001E5B)'; });
    shareBtn.addEventListener('click', () => {
      const url = location.href.split('?')[0];
      navigator.clipboard.writeText(url).then(() => {
        ping({ event: 'deck_shared' });
        const orig = shareBtn.innerHTML;
        shareBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        shareBtn.style.background = '#022AC0'; shareBtn.style.color = '#fff';
        setTimeout(() => { shareBtn.innerHTML = orig; shareBtn.style.background = 'var(--white,#fff)'; shareBtn.style.color = 'var(--sf-navy,#001E5B)'; }, 2000);
      }).catch(() => {});
    });
    controls.appendChild(shareBtn);
  }

  // ── Init ───────────────────────────────────────────────────────────────
  ping({ event: 'deck_open' });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { injectPresentBtn(); injectShareBtn(); });
  } else {
    injectPresentBtn(); injectShareBtn();
  }
  watchSlides();
  renderThread();
  updateSlideLabel();

})();
