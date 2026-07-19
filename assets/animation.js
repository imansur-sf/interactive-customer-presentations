/* Decktools · Animation Engine
   Part 1: slide entrance animations (fade-up, scale-in, etc.)
   Part 2: interactive animation utilities (typeInto, countUp, fillBar, etc.)
   ──────────────────────────────────────────────────────────────────── */
(() => {
  const STAGGER = 60; // ms between each animated element

  function animateSlide(slide) {
    const els = slide.querySelectorAll('[data-animate]');
    els.forEach((el, i) => {
      el.classList.remove('anim-in');
      // Read per-element stagger override, else use index
      const delay = parseInt(el.dataset.animDelay ?? (i * STAGGER), 10);
      el.style.setProperty('--anim-delay', delay + 'ms');
      // rAF ensures transition fires after class removal settles
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('anim-in'));
      });
    });
  }

  function resetSlide(slide) {
    slide.querySelectorAll('[data-animate]').forEach(el => {
      el.classList.remove('anim-in');
      el.style.removeProperty('--anim-delay');
    });
  }

  // Watch for .slide gaining .active
  const observer = new MutationObserver(mutations => {
    mutations.forEach(({ target, oldValue }) => {
      const wasActive = (oldValue || '').split(' ').includes('active');
      const isActive  = target.classList.contains('active');
      if (!wasActive && isActive) animateSlide(target);
      if (wasActive && !isActive)  resetSlide(target);
    });
  });

  document.querySelectorAll('.slide').forEach(slide => {
    observer.observe(slide, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
    // Animate the initially-active slide on load
    if (slide.classList.contains('active')) {
      // Small delay so CSS transitions are registered
      setTimeout(() => animateSlide(slide), 50);
    }
  });
})();

/* ─────────────────────────────────────────────────────────────────
   Part 2 · Interactive Animation Utilities
   All functions are global (window.*) — call from any deck script.
   Abort pattern: pass an object { v: false }; set .v = true to cancel.
   ───────────────────────────────────────────────────────────────── */

/* Core primitives */

window.wait = (ms) => new Promise(r => setTimeout(r, ms));

// guard: optional makeSequence guard fn — if provided, typeInto throws 'aborted' when cancelled
window.typeInto = (el, text, speed = 28, guard = null) => new Promise((resolve, reject) => {
  el.textContent = '';
  let i = 0, last = 0;
  const step = (now) => {
    if (!last) last = now;
    const elapsed = now - last;
    const pause = /[.,!?]/.test(text[i - 1]) ? speed * 5 : speed;
    if (elapsed >= pause) { i++; el.textContent = text.slice(0, i); last = now; }
    if (i < text.length) {
      // Check guard abort flag via a zero-ms wait probe
      if (guard) {
        guard(0).then(() => requestAnimationFrame(step)).catch(reject);
      } else {
        requestAnimationFrame(step);
      }
    } else {
      resolve();
    }
  };
  requestAnimationFrame(step);
});

window.countUp = (el, target, ms = 1200) => new Promise(resolve => {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.floor(eased * target).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
    else { el.textContent = target.toLocaleString(); resolve(); }
  };
  requestAnimationFrame(step);
});

window.fillBar = (fillEl, pct, ms = 1000) => new Promise(resolve => {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    fillEl.style.width = (eased * pct) + '%';
    if (t < 1) requestAnimationFrame(step); else resolve();
  };
  requestAnimationFrame(step);
});

/* fillRing: svgCircleEl must have stroke-dasharray set to its circumference */
window.fillRing = (circleEl, pct, ms = 1000) => new Promise(resolve => {
  const circ = parseFloat(circleEl.getAttribute('stroke-dasharray') || 326);
  const target = circ - circ * (pct / 100);
  const startOffset = parseFloat(circleEl.getAttribute('stroke-dashoffset') || circ);
  const startTime = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - startTime) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    circleEl.setAttribute('stroke-dashoffset', startOffset + (target - startOffset) * eased);
    if (t < 1) requestAnimationFrame(step); else resolve();
  };
  requestAnimationFrame(step);
});

/* streamItem: appends a new item to a .stream-list and trims to maxVisible */
window.streamItem = (listEl, html, maxVisible = 4) => {
  const li = document.createElement('li');
  li.className = 'stream-item';
  li.innerHTML = html;
  listEl.appendChild(li);
  requestAnimationFrame(() => li.classList.add('show'));
  while (listEl.children.length > maxVisible) listEl.removeChild(listEl.firstChild);
};

/* reveal: adds .revealed to one or more elements (selector string or NodeList) */
window.reveal = (ctx, selector) => {
  const els = typeof selector === 'string' ? ctx.querySelectorAll(selector) : selector;
  els.forEach(el => el.classList.add('revealed'));
};

/* makeSequence: builds an async sequence with abort + guard support.
   Usage:
     const seq = makeSequence();
     seq.run(async (guard) => {
       reveal(wrap, '.flow-node[data-step="1"]');
       await guard(600);
       // ...
     });
     seq.abort(); // call to cancel mid-run and reset
*/
window.makeSequence = () => {
  let abortFlag = false;
  let running = false;

  const guard = (ms) => wait(ms).then(() => {
    if (abortFlag) throw new Error('aborted');
  });

  return {
    async run(fn) {
      abortFlag = true;
      await wait(30);
      abortFlag = false;
      running = true;
      try { await fn(guard); }
      catch (e) { /* aborted or error — caller handles reset */ }
      finally { running = false; }
    },
    abort() { abortFlag = true; running = false; },
    get running() { return running; }
  };
};
