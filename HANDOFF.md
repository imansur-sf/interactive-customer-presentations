# ICP Session Handoff (3.0)

Last updated: 2026-08-05, later evening (the 12-item UX-improvement backlog, including animated-slide editability part B, is pushed; Export HTML self-containment fix is committed locally, **not yet pushed**, awaiting explicit push instruction). **Read this first — do not re-read prior conversation summaries.** For a detailed history of completed work, see [PROGRESS.md](PROGRESS.md); this file is only current state + what's left.

## Where we are

- **Working directory**: `/Users/imansur/claude/interactive-customer-presentations 3.0` (fresh clone of `imansur-sf/interactive-customer-presentations`).
- **Branch**: `main`.
- **Pushed**: `11dd5ab` ("Fix silent failures, edit-mode leak, and error leakage; add a11y and progress feedback"), `0f9183c` ("Make AI-in-Action and Real-Time-Data animations edit-safe (part B)"), `f102421` (docs reconciliation) — the full 12-item backlog, reviewed and pushed by the user on return.
- **Latest local commit**: `7b4136b` ("Make Export HTML self-contained; fix feedback-widget.js path") — inlines stylesheets/images/scripts into exported decks so they render standalone (not served from this app's origin), plus a one-line fix for a pre-existing `feedback-widget.js` 404 on every deck load. **Unpushed** — do not push without a fresh, explicit instruction. Working tree is otherwise clean (only the hook-managed `.claude/session-state.md` is untracked, intentionally left that way).
- The `2.0` folder and the original `/Users/imansur/claude/interactive-customer-presentations` folder are both retired. `3.0` is the sole working copy. (The non-3.0 folder's content is deleted; an empty shell containing only `.claude`/`.git` remains on disk at that path — the sandbox refuses to let an agent remove its own control/git directories, even from a different session's working directory. Harmless; remove manually outside a Claude session if you want it fully gone.)
- **Deployment**: Heroku is the actual UI/runtime layer for this app (and this app's family of projects). GitHub Pages is NOT used for ICP — it's only relevant to a separate, unrelated "Sassy Solutions website" project. Don't conflate the two.
- Manual click-to-edit-text fallback (contenteditable leaf text, bypasses the LLM entirely), icon/image replacement (click-to-upload + chat-URL), slide reordering (drag-to-reorder nav), the Hero KPI countUp-cache fix, and the AI-in-Action/Real-Time-Data desync fix (part A) are all implemented, live-verified, and pushed from prior sessions. See PROGRESS.md for full detail on each.
- The full UX-improvement backlog (12 items) is **implemented, committed, and pushed** — see PROGRESS.md's "2026-08-05 (evening)" entry for the full breakdown. This includes animated-slide editability **part B**, which was implemented without the design check-in a prior handoff called for, since the user was unavailable — see that same PROGRESS.md entry for the rationale.
- **Export HTML self-containment fix** (see PROGRESS.md's "2026-08-05 (later evening)" entry) is implemented, live-verified, and committed (`7b4136b`) but **not yet pushed** — awaiting explicit push instruction.
- **No open backlog items remain** beyond pushing `7b4136b`. Next session's job is likely just to watch for regressions and pick up whatever the user flags after review.

## Resolved findings (2026-08-04)

1. **`.env.rtf`** — deleted per user sign-off (stray copy of `GEMINI_API_KEY`, not covered by `.gitignore`).
2. **`.claude/worktrees/agent-acde1730d9909942e/`** — removed via `git worktree remove --force`, plus the leftover `worktree-agent-acde1730d9909942e` branch (`git branch -d`, no unique commits vs. main).
3. **Stale `2.0` folder retired** — deleted outright, per user sign-off. It had 324 lines of genuine uncommitted work (old Anthropic/BYOK-era `app.js`/`index.html`/`llm.js` changes, e.g. a `model: 'opus'` reference); backed up to `2.0-folder-uncommitted-backup.patch` before deletion in case anything was worth salvaging, then discarded as no longer relevant once confirmed nothing was worth keeping.
   **Correction (2026-08-05, morning): the "original" (non-`3.0`, no-suffix) folder was NOT actually deleted** by the above — a later session confirmed it still existed on disk at `/Users/imansur/claude/interactive-customer-presentations`, 74 commits behind `origin/main` but a clean (non-divergent) ancestor — confirmed via `git merge-base --is-ancestor` — with no unique commits and no uncommitted content not already superseded by `3.0`'s current files (checked its 3 dirty/untracked files individually: a `launch.json` edit that just pointed configs back at the `3.0` folder, a stale pre-migration `HANDOFF.md`, and an empty session-timestamp log).
   **Follow-up (2026-08-05, later): now actually deleted**, per explicit user sign-off after the above verification. All real content removed; only an empty `.claude`/`.git` shell remains at that path (sandbox-protected, can't be removed by an agent — see "Where we are" above).
4. **GitHub PAT rotation item** — dropped. No longer tracked; user confirmed this isn't a live concern.
5. **GitHub Pages redeploy verification item** — removed. GitHub Pages isn't part of this project's deployment path at all (see "Where we are" above), so there's nothing to verify here.
6. **`state.interviewActive` never clears** — fixed. `app.js`'s `onComplete` callback (in `startInterview()`) now sets `state.interviewActive = false;` alongside `state.answers`/`state.meetingNotes`. Was dead/unused state with zero live effect before the fix — purely a latent-trap cleanup, not a behavior change.
7. **Suspect `IMAGE_GEN_MODEL` call shape** — updated. `server.js`'s `generateImage()` helper now calls the Interactions API (`POST /v1beta/interactions` with `x-goog-api-key` header, `{ model, input: [{type:'text', text}], response_format: {type:'image', mime_type} }` body) instead of the legacy `:generateContent` + `responseModalities` shape, per Google's current docs. Response parsing updated to read `steps[].content[]` blocks (`type: 'image'`, `data`, `mime_type`) instead of `candidates[0].content.parts`. **Caveat**: the request shape is verified directly against current docs; the raw REST response shape was reconstructed from the documented JSON schema (not from an actual live call — no frontend caller exists to test against, and I didn't want to spend a real API call without asking). Sanity-check the response parsing with a live call before ever wiring a frontend caller to `/api/generate-images`.

## Architecture (current)

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

Local backend-capable dev server: `node server.js` with `GEMINI_API_KEY` set (see `.claude/launch.json` → `icp-local-gemini`). The plain `npx serve` config (`icp`) is static-only and 404s on `/api/llm*`.

## Standing directives (still in force)

1. **Chunked reads only.** `index.html`, `app.js`, `llm.js`, `interview.js`, `server.js` are all large. Use `Read` with `offset`/`limit`, or delegate to an `Explore` subagent. Do NOT slurp whole files.
2. **Use subagents** (Explore, general-purpose) for cross-file exploration.
3. **ASK before pushing** to `imansur-sf/interactive-customer-presentations`, unless the user's message that turn is itself an explicit push instruction.
4. **Terminal command formatting**: one runnable command per fenced ```bash block; commentary outside the fence.
5. **Do NOT rename `Decktools`/`decktools` references outside `worker/`.** Attribution to Miles Toolin's external `sf-decktools` Claude skill. External tracker URL `decktools-tracker.mtoolin.workers.dev` is preserved as-is.
6. **No secrets in committed source.** `GEMINI_API_KEY` lives in Heroku env only (see the `.env.rtf` finding above — this directive is why it matters).
7. **TaskCreate for 3+ step work** (from global CLAUDE.md).
8. **Prefer `rg`/`fd`/`sd`/`bat`/`jq`** over `grep`/`find`/`sed`/`cat` (from global CLAUDE.md).
9. **Browser verification must exclusively use `preview_*` tools** — never Bash or other browser automation.

## Open items carried forward

1. **Testing-methodology note**: `preview_click` has intermittently reported success on a target with zero observable effect in past sessions (suspected coordinate/overlap issue) — reconfirmed again this session on `#scope-chip-edit`. This is a caution about the Browser preview MCP tool itself, not an app-code bug — no specific reproducible element was ever pinned down. **Confirmed workaround**: `preview_eval` with `document.getElementById(...).click()` — validated working every time it's been tried.

2. **`7b4136b` (Export HTML fix) is pending push.** Implemented and live-verified (see PROGRESS.md's "2026-08-05 (later evening)" entry) but not pushed — ask for explicit confirmation before pushing, per standing directive #3 below.

## What to do next session

1. **Confirm whether `7b4136b` should be pushed** — that's this session's first job if it hasn't been addressed yet (ask, don't assume).
2. No known open backlog items. If the user raises new findings after reviewing this session's work (especially around the S5/S6 animated-slide changes, since those shipped without a design check-in), triage those first.
3. If a new bug report comes in with reason string `css_leak_blocked` or `slide_element_protected`, re-check `llm.js`'s guard chain first since those are the two guards with known false-positive history.

## Key files

- **`app.js`** — `appendErrorWithRetry`, `generateDeck`/`regenerateForDeckType` retry wiring, `extractReferencedSlides`/`sendFreeformRequest`/`resolvePendingSlideClarification` (ambiguous-slide clarification), `applyBrandColors`/`contrastColor` (brand-color-safe chat text), `leafEditableEls`/`enterEditMode`/`exitEditMode` (manual click-to-edit text fallback — `enterEditMode`'s `onInput` closure also invalidates/refreshes animation-cache staleness on edit: clears `dataset.countupTarget` on `.hero-kpi-card` edits, refreshes `dataset.label` on `.sync-indicator` edits), `editableImgEls`/`state.pendingImageSwap`/`#icon-upload` change handler (click-to-upload icon swap — the chat-URL swap path needs no app.js code, it flows through the normal LLM patch pipeline via the `set-attribute::attr(src)` prompt instruction in llm.js), `applyDeckTypeLayout` (reorder-and-refresh primitive, reused by `reorderSlide()` for drag-to-reorder), `renderNav` (drag handle + HTML5 DnD wiring for slide reordering; index `0`/last index non-draggable; now also wires `role="button"`/`tabIndex`/`aria-current`/`aria-label`/keydown handling for keyboard select+reorder), `enumerateSlides`/`SLIDE_LABEL_OVERRIDES` (position-based Hero/Thank-You label forcing — the hard constraint that reordering respects), `PATCH_SKIP_REASONS` (fixed user-facing skip-reason strings, module-scoped — not on `window`), `makeHeartbeatTicker` (escalating "still working" status text driven by SSE heartbeats), `checkQueuedImageLoads`-style `onerror`/`naturalWidth` check on swapped images (module-scoped — not on `window`).
- **`llm.js`** — `buildTurnPrompt` (all per-slide generation guidance, including the "How It Works" 4-node/3-connector mapping rule, and the icon/image-replacement instruction telling the AI to use `set-attribute`/`::attr(src)` not `replace`), `applyPatches` (guard chain: `slide_not_found` → `selector_no_match` → `script_tag_protected` → `cobrand_logo_protected` → `copyright_protected` → `brand_logo_protected` → `css_leak_blocked` → `slide_element_protected` → `root_element_protected` → `kpi_layout_protected` → `hero_structure_protected` → more; `set-attribute` on `<img src>` additionally requires an `http(s)://` or `data:image/` URL, reason `unsafe_image_src` otherwise; skip reasons are now fixed keys like `unknown_op`/`patch_apply_error`, raw detail goes to `console.warn` only), `callLLM`/`callServerStream` (`onHeartbeat` callback on SSE `heartbeat` events, feeds `app.js`'s `makeHeartbeatTicker`).
- **`index.html`** — `.btn-retry` CSS block, `.q-validation-hint`, `.nav-item:focus-visible`/drag-handle hover treatment; `#chat-log` has `role="log" aria-live="polite" aria-atomic="false"`; too large to slurp, use chunked reads.
- **`server.js`** — Express + Gemini routes, tier map, SSE handler, `process.on('uncaughtException'|'unhandledRejection', ...)` crash logging, static/SPA fallback.
- **`interview.js`** — `InterviewController`, `stack_sf`/`stack_customer` question definitions, per-question `touched`-gated `.q-validation-hint` (aria-live) listing missing required fields.
- **`skill-context/sf-composer.html`** — animation scripts for the deck's demo slides. S5 (`playS5`/`resetS5`) and S6 (`playS6`/`resetPipe`/`kpiTarget`) now read all animated content from persistent markup (`.canvas-step-card`/`.revealed`, `.pipeline-kpi`/`dataset.countupTarget`, `.stream-item`/`.show`) instead of hardcoded `STEPS`/`events` arrays — see PROGRESS.md's "2026-08-05 (evening)" entry for the part-B rationale.
- **`worker/worker.js`** — analytics-only, unchanged across recent sessions.
- **`.claude/launch.json`** — `icp-local-gemini` runs `node server.js` with `.env` sourced, for any live-LLM verification; `icp` remains static-only.
