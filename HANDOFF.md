# ICP Session Handoff (3.0)

Last updated: 2026-08-05 (slide reordering + Hero KPI fix + AI-in-Action/Real-Time-Data desync fix part A — all implemented, live-verified, and pushed). **Read this first — do not re-read prior conversation summaries.** For a detailed history of completed work, see [PROGRESS.md](PROGRESS.md); this file is only current state + what's left.

## Where we are

- **Working directory**: `/Users/imansur/claude/interactive-customer-presentations 3.0` (fresh clone of `imansur-sf/interactive-customer-presentations`).
- **Branch**: `main`.
- **Latest pushed commit**: see `git log -1` — this session's push includes icon/image replacement, slide reordering, the Hero KPI cache fix, and the AI-in-Action/Real-Time-Data desync fix (part A). Nothing uncommitted should remain from this session.
- The `2.0` folder and the original `/Users/imansur/claude/interactive-customer-presentations` folder have been **retired** (removed entirely) — see Resolved findings below. `3.0` is the sole working copy.
- **Deployment**: Heroku is the actual UI/runtime layer for this app (and this app's family of projects). GitHub Pages is NOT used for ICP — it's only relevant to a separate, unrelated "Sassy Solutions website" project. Don't conflate the two.
- Manual click-to-edit-text fallback (contenteditable leaf text, bypasses the LLM entirely), icon/image replacement (click-to-upload + chat-URL), slide reordering (drag-to-reorder nav), the Hero KPI countUp-cache fix, and the AI-in-Action/Real-Time-Data desync fix (part A) are all implemented, live-verified, and pushed. See PROGRESS.md for full detail on each. Two items remain open: animated-slide editability **part B** (new UI surface for JS-only content — explicitly deferred, see item 3 below) and a UX-improvement analysis (in progress, see Task #6).

## Resolved findings (2026-08-04)

1. **`.env.rtf`** — deleted per user sign-off (stray copy of `GEMINI_API_KEY`, not covered by `.gitignore`).
2. **`.claude/worktrees/agent-acde1730d9909942e/`** — removed via `git worktree remove --force`, plus the leftover `worktree-agent-acde1730d9909942e` branch (`git branch -d`, no unique commits vs. main).
3. **Stale `2.0` and original folders retired** — both deleted outright. Correction to a prior handoff's framing: they were NOT divergent/different-git-history repos — `git merge-base --is-ancestor` confirmed both were simple outdated checkouts of the exact same origin remote, just behind on pulls. The `2.0` folder had 324 lines of genuine uncommitted work (old Anthropic/BYOK-era `app.js`/`index.html`/`llm.js` changes, e.g. a `model: 'opus'` reference); backed up to `2.0-folder-uncommitted-backup.patch` before deletion in case anything was worth salvaging. Per user sign-off, that patch has since been discarded as no longer relevant — nothing was salvaged from it.
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

2. **"AI in Action"/"Real-Time Data" slide editability — part B only remains open.** Part A (make the static HTML the single source of truth for the animation scripts, so editing the static copy no longer silently desyncs from what Play renders) is done — see PROGRESS.md's 2026-08-04/05 entry. Part B is the bigger lift, deliberately deferred:
   - **(B) JS-only content** — no static HTML counterpart at all, so it's invisible to both the AI-patch pipeline (`script_tag_protected` guard blocks anything inside a `<script>` tag) and manual-edit-mode (only ever attaches `contenteditable` to HTML text nodes). Examples: slide 5's `STEPS` array (7 journey-step objects: label/platform/color, rendered only via `createElement` into `#s5-steps`/`#s5-canvas` at Play time); slide 6's `events` array (8 stream-feed strings rendered via `streamItem()` into `#s6-stream`); slide 6's `countUp()` numeric targets (142800, 47, 3200, and the hardcoded string `'28ms'`) — the static "0" KPI placeholders are editable today but pointless, since Play immediately overwrites them.
   - **Fix (bigger lift — new UI surface)**: lift these into small, visible, in-flow markup blocks in `deckDoc` that the script reads from at Play time instead of a hardcoded array/literal — e.g. an editable `<li>` list for journey steps and stream events; static KPI numbers that double as both the displayed placeholder text and a `data-target` attribute for `countUp()` to parse. This changes visible layout, not just wiring — scope as its own follow-up with a quick design check-in (what the editable steps/events list should look like) before implementing, rather than folding it into a fast session.

## What to do next session

1. Pick up animated-slide editability **part B** (above) when ready to scope a new UI surface — needs a quick design check-in first, not a blind implement.
2. Read the UX-improvement analysis produced at the end of this session (see PROGRESS.md / conversation) and decide which ideas, if any, to act on.
3. If a new bug report comes in with reason string `css_leak_blocked` or `slide_element_protected`, re-check `llm.js`'s guard chain first since those are the two guards with known false-positive history.

## Key files

- **`app.js`** — `appendErrorWithRetry`, `generateDeck`/`regenerateForDeckType` retry wiring, `extractReferencedSlides`/`sendFreeformRequest`/`resolvePendingSlideClarification` (ambiguous-slide clarification), `applyBrandColors`/`contrastColor` (brand-color-safe chat text), `leafEditableEls`/`enterEditMode`/`exitEditMode` (manual click-to-edit text fallback — `enterEditMode`'s `onInput` closure also invalidates/refreshes animation-cache staleness on edit: clears `dataset.countupTarget` on `.hero-kpi-card` edits, refreshes `dataset.label` on `.sync-indicator` edits), `editableImgEls`/`state.pendingImageSwap`/`#icon-upload` change handler (click-to-upload icon swap — the chat-URL swap path needs no app.js code, it flows through the normal LLM patch pipeline via the `set-attribute::attr(src)` prompt instruction in llm.js), `applyDeckTypeLayout` (reorder-and-refresh primitive, reused by `reorderSlide()` for drag-to-reorder), `renderNav` (drag handle + HTML5 DnD wiring for slide reordering; index `0`/last index non-draggable), `enumerateSlides`/`SLIDE_LABEL_OVERRIDES` (position-based Hero/Thank-You label forcing — the hard constraint that reordering respects).
- **`llm.js`** — `buildTurnPrompt` (all per-slide generation guidance, including the "How It Works" 4-node/3-connector mapping rule, and the icon/image-replacement instruction telling the AI to use `set-attribute`/`::attr(src)` not `replace`), `applyPatches` (guard chain: `slide_not_found` → `selector_no_match` → `script_tag_protected` → `cobrand_logo_protected` → `copyright_protected` → `brand_logo_protected` → `css_leak_blocked` → `slide_element_protected` → `root_element_protected` → `kpi_layout_protected` → `hero_structure_protected` → more; `set-attribute` on `<img src>` additionally requires an `http(s)://` or `data:image/` URL, reason `unsafe_image_src` otherwise).
- **`index.html`** — `.btn-retry` CSS block; too large to slurp, use chunked reads.
- **`server.js`** — Express + Gemini routes, tier map, SSE handler, `process.on('uncaughtException'|'unhandledRejection', ...)` crash logging, static/SPA fallback.
- **`interview.js`** — `InterviewController`, `stack_sf`/`stack_customer` question definitions.
- **`worker/worker.js`** — analytics-only, unchanged across recent sessions.
- **`.claude/launch.json`** — `icp-local-gemini` runs `node server.js` with `.env` sourced, for any live-LLM verification; `icp` remains static-only.
