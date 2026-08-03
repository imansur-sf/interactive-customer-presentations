# ICP Session Handoff (3.0)

Last updated: 2026-08-03. **Read this first — do not re-read prior conversation summaries.**

## Where we are

- **Working directory**: `/Users/imansur/claude/interactive-customer-presentations 3.0` (fresh clone of `imansur-sf/interactive-customer-presentations`).
- **Branch**: `main`.
- **Latest commit**: `8f78aff` — "Fix contrast issues, brand-color-safe chat text, and ambiguous slide-ref handling" — **pushed to `origin/main`**. Nothing local is ahead of origin.
- The `2.0` folder and the original `/Users/imansur/claude/interactive-customer-presentations` folder are **STALE** (older BYOK/Anthropic-era architecture, different git history). Do NOT work in them.
- The stale folder's `.claude/launch.json` was retargeted in a prior session to serve the `3.0` folder for browser verification. If the next session's CWD is the stale folder, `preview_start` will still serve the correct code — but verify before trusting it.

## Architecture (CURRENT — do not rely on old HANDOFF.md architecture section)

```
Browser
  ├─ LLM calls  ──►  Heroku app (server.js) ──►  Google Gemini API
  │                   POST /api/llm (regular) or /api/llm-stream (SSE, 240s)
  │                   Tier map: fast/balanced/powerful
  │                     → gemini-3.5-flash-lite / gemini-3.5-flash / gemini-2.5-pro
  │                   GEMINI_API_KEY lives in Heroku env
  │
  └─ Analytics ──►  Cloudflare Worker (worker/worker.js)
                     /imranAI/track → decktools-tracker.mtoolin.workers.dev/track
```

## Standing directives (still in force)

1. **Chunked reads only.** `index.html`, `app.js`, `llm.js`, `interview.js`, `server.js` are all large. Use `Read` with `offset`/`limit`, or delegate to an `Explore` subagent. Do NOT slurp whole files.
2. **Use subagents** (Explore, general-purpose) for cross-file exploration.
3. **ASK before pushing** to `imansur-sf/interactive-customer-presentations`, unless the user's message that turn is itself an explicit push instruction (as happened this session).
4. **Terminal command formatting**: one runnable command per fenced ```bash block; commentary outside the fence.
5. **Do NOT rename `Decktools`/`decktools` references outside `worker/`.** Attribution to Miles Toolin's external `sf-decktools` Claude skill. External tracker URL `decktools-tracker.mtoolin.workers.dev` is preserved as-is.
6. **No secrets in committed source.** `GEMINI_API_KEY` lives in Heroku env only.
7. **TaskCreate for 3+ step work** (from global CLAUDE.md).
8. **Prefer `rg`/`fd`/`sd`/`bat`/`jq`** over `grep`/`find`/`sed`/`cat` (from global CLAUDE.md).
9. **Browser verification must exclusively use `preview_*` tools** — never Bash or other browser automation.

## Just shipped (this session) — commit `8f78aff`, pushed

Executed a 3-phase plan (approved via plan mode) that closed out the contrast and accent-color risk items flagged as open in the previous handoff, plus added a new clarification flow:

1. **Phase 1 — Contrast fixes in `skill-context/sf-composer.html` + `assets/components.css`.** Fixed the four items previously documented-but-deferred: `.arch-tag`/`.bc-badge`/`.phase-badge` (brand-color-on-tint-of-self badges), the recurring `rgba(255,255,255,0.35)` navy caption pattern, and the `.c-arrow` decorative arrows on "Next Steps". All now clear WCAG AA (verified with `preview_inspect` computed contrast, not source-level guesses).
2. **Phase 2 — Chat bubble text is now brand-color-safe.** `.chat-msg.user` in `assets/animation-interactions.css` no longer hardcodes `color: #fff`; it reads `var(--chat-user-fg, #fff)`. `applyBrandColors()` in `app.js` now sets `--chat-user-fg` via the existing `contrastColor(hex)` helper right after it sets `--sf-blue` from the customer's chosen accent — so a pale customer accent color can no longer wash out the chat text. `.chat-bot-label` was checked and confirmed **not** at risk (its color var is never touched by `applyBrandColors`).
3. **Phase 3 — Ambiguous slide-reference clarification flow (new capability, not just a fix).** `extractReferencedSlides()` (`app.js`) now returns `{ slides, ambiguousLabels }` instead of a bare array — when a vague keyword matches more than one slide, it's surfaced instead of silently falling back to "whichever slide is on screen." `sendFreeformRequest` checks this: if ambiguous, it asks a clarifying question in-chat ("Did you mean the X or the Y slide?") and stores `state.pendingSlideClarification = { candidates, originalText }` instead of calling the LLM. `resolvePendingSlideClarification` (new function) handles the user's next message: if it resolves against a candidate (by label or alias), it re-issues the **original** stored request against the resolved slide; if not, it falls through to treating the reply as a brand-new freeform request.
4. **Bug found and fixed during Phase 3 verification**: `resolvePendingSlideClarification` was calling `appendMessage('user', replyText)` unconditionally, then falling through to `sendFreeformRequest(replyText)` in the unresolved case — which appends the same message again. Result: an unrelated reply to a clarifying question showed up as two identical "YOU" chat bubbles. Fixed by moving the `appendMessage` call inside the `if (resolved)` branch only, so the unresolved path relies solely on `sendFreeformRequest`'s own append.

All of the above was verified **live in the browser via real chat UI interaction** (`preview_fill`/`preview_click`, not `preview_eval` simulation) — including a fetch-monkeypatch technique to inspect outgoing `/api/llm-stream` POST payloads, since `app.js`'s top-level `state` isn't reachable from `preview_eval` (it's an ES module, not global). Confirmed: ambiguity correctly short-circuits the LLM call, a valid disambiguating reply resolves to the correct slide and reuses the original request text, and an unrelated reply falls through cleanly without duplication.

## Resolved from the previous handoff's open-items list

- ~~"How It Works" architecture-diagram badges below AA~~ — fixed (Phase 1).
- ~~Recurring `rgba(255,255,255,0.35)` navy caption pattern~~ — fixed (Phase 1).
- ~~"Start Here"/"The Path Forward" badges~~ — fixed (Phase 1).
- ~~"Next Steps" decorative arrows~~ — fixed (Phase 1), even though arguably decorative — cheap and no downside.
- ~~`.chat-msg.user`/`.chat-bot-label` not contrast-checked against customer-chosen accent colors~~ — fixed (Phase 2). `.chat-bot-label` turned out not to be at risk at all.
- ~~Vague keyword matching >1 slide silently guesses~~ — replaced with an actual clarifying-question mechanism (Phase 3), not just documented as a known limitation anymore.
- ~~Push the pending commits~~ — done, `8f78aff` is on `origin/main`.

## Open items carried forward (not touched this session)

- **Rotate any GitHub PAT exposed in earlier sessions** — flagged in at least two prior handoffs, status still unconfirmed. Keep raising this until explicitly resolved.
- **Verify GitHub Pages redeploy** picks up commit `8f78aff` — typically ~30s after push, not independently confirmed this session.
- **Retire the stale `2.0` folder and the original folder** once confident `3.0` is the definitive source of truth — still not done, still optional.
- **`state.interviewActive` never clears** (`interview.js` sets it `true` on start, `onComplete` never clears it) — not load-bearing, low-priority cleanup, unchanged from before.
- **Suspect model ID**: `server.js:23` — `IMAGE_GEN_MODEL = 'gemini-3.1-flash-image'`. Still unverified as a live model name.
- **Unresolved thread from earlier in this session, status unknown**: a background-subagent investigation into a "0 of 14 personalization patches applied" bug in `applyPatches` (`llm.js`) was reportedly running independently and was explicitly *not* folded into the 3-phase plan (different code path). No findings or fix from that investigation appear in this session's final work. **Check whether that investigation actually concluded** before assuming it's still open — it may have been resolved and just not reflected here, or it may never have finished.
- **Local dev testing caveat, unchanged**: `npx serve` (per `.claude/launch.json`) is a static file host with no `/api/llm*` backend. POSTs to `/api/llm-stream` return a generic 404 HTML page in this environment, and the app's error-display path (`⚠️ ${err.userMessage || err.message}`) renders that raw HTML as the assistant's error text — cosmetically bad but not a real app bug, just a symptom of no backend being wired into the static preview. To exercise the real LLM path locally, run `node server.js` with `GEMINI_API_KEY` set.
- **Testing-methodology note, unchanged**: `preview_click` has intermittently reported success on a target with zero observable effect in past sessions (suspected coordinate/overlap issue). Workaround if it recurs: `preview_eval` with `document.getElementById(...).click()`. Not observed as a problem this session (`#btn-send` clicks all worked normally).

## Key files (post-commit state)

- **`app.js`** —
  - `extractReferencedSlides()` (~L783-844 pre-session, now returns `{ slides, ambiguousLabels }`) — 6-tier matcher: digit → number/ordinal word → "last/final slide" → literal label/alias → vague-keyword (ambiguous if the word matches >1 slide) → fallback to currently-viewed slide.
  - `sendFreeformRequest()` (~L719-754 pre-session) — now branches on `ambiguousLabels`; if non-empty, appends a clarifying question and sets `state.pendingSlideClarification` instead of calling the LLM.
  - `resolvePendingSlideClarification()` (new function) — resolves the next user message against pending candidates, or falls through to `sendFreeformRequest`.
  - `sendMessage()` (~L961-973 pre-session) — now checks `state.pendingSlideClarification` first, before normal routing.
  - `applyBrandColors()` (~L344-376 pre-session) — now also sets `--chat-user-fg` via `contrastColor()` right after setting `--sf-blue`.
  - `contrastColor(hex)` (~L1343-1351 pre-session) — existing helper, reused as-is (no changes), same luminance-based `#fff`/`#0B0930` logic already used for `--accent-fg`/`--accent-secondary-fg`.
- **`assets/animation-interactions.css`** — `.chat-msg.user` (~L44-49) — `color` now `var(--chat-user-fg, #fff)` instead of hardcoded `#fff`.
- **`assets/components.css`** — `.arch-tag`/`.bc-badge`/`.phase-badge`/`.c-arrow`/`.proof-source` contrast values adjusted (Phase 1).
- **`skill-context/sf-composer.html`** — navy caption opacity and badge color/opacity adjustments (Phase 1); loaded at runtime via `fetch()` by `llm.js:loadSkillContext`, so this is live content, not just a design reference.
- **`server.js`** — Express + Gemini. Unchanged this session. `GEMINI_API_KEY` @ L17, tier map @ L27-35, SSE @ L362, static server + SPA fallback @ L576/L582.
- **`llm.js`** — Unchanged this session. Turn types: `suggest`, `freeform`, `edit`, `generate`, `progressive`, `finalize`, default. `callLLM` routes to SSE for heavy turns (incl. `freeform`), with `AbortController` support. `buildTurnPrompt` composes `userMessage`/`deckContext` into a single `prompt` string — they are **not** top-level POST fields, which matters if you're inspecting outgoing payloads directly.
- **`interview.js`** — `InterviewController`. Unchanged this session.
- **`worker/worker.js`** — analytics-only. Unchanged this session.

## What to do next session

No known bugs pending from this session's work — all three plan phases are shipped, verified live, and pushed. Suggested priorities, roughly in order:

1. Check on the "0 of 14 personalization patches" investigation thread (see open items above) — resolve ambiguity about whether it's done, abandoned, or still needs a fix.
2. Confirm GitHub Pages redeploy picked up `8f78aff`.
3. Rotate the previously-flagged GitHub PAT if that still hasn't happened.
4. Decide whether to retire the stale `2.0`/original folders now that `3.0` has a clean, fully-pushed history.
