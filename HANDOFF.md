# ICP Session Handoff (3.0)

Last updated: 2026-08-03. **Read this first — do not re-read prior conversation summaries.**

## Where we are

- **Working directory**: `/Users/imansur/claude/interactive-customer-presentations 3.0` (fresh clone of `imansur-sf/interactive-customer-presentations`).
- **Branch**: `main`.
- **Latest commit**: `cb3be25` — "Stop clearScope() from nulling activeSlideIdx".
- **Local branch is 5 commits ahead of `origin/main`, none pushed.** Do NOT push without asking the user first (standing directive, still in force).
- The `2.0` folder and the original `/Users/imansur/claude/interactive-customer-presentations` folder are **STALE**. Do NOT work in them.
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
3. **ASK before pushing** to `imansur-sf/interactive-customer-presentations`. Auto-push is NOT authorized in 3.0.
4. **Terminal command formatting**: one runnable command per fenced ```bash block; commentary outside the fence.
5. **Do NOT rename `Decktools`/`decktools` references outside `worker/`.** Attribution to Miles Toolin's external `sf-decktools` Claude skill. External tracker URL `decktools-tracker.mtoolin.workers.dev` is preserved as-is.
6. **No secrets in committed source.** `GEMINI_API_KEY` lives in Heroku env only.
7. **TaskCreate for 3+ step work** (from global CLAUDE.md).
8. **Prefer `rg`/`fd`/`sd`/`bat`/`jq`** over `grep`/`find`/`sed`/`cat` (from global CLAUDE.md).
9. **Browser verification must exclusively use `preview_*` tools** — never Bash or other browser automation.

## Just shipped (this session)

Picked up from the deferred-fixes list in the old HANDOFF.md, then ran a full autonomous UX audit per standing instruction. Six commits, oldest first:

1. **`c46225a` — Visible patch-application result badge.** `applyPatches` skips were previously only `console.warn`'d. Chat now shows "Applied N of M — X skipped" with a details expander.
2. **`e762c65` — Broadened slide-reference detection.** `extractReferencedSlides` (`app.js:781-842`) went from a single digit regex to a 6-tier matcher: digit → number/ordinal word → "last/final slide" → literal label/alias → vague-keyword (only if the word is unique to exactly one slide) → fallback to the currently-viewed slide.
3. **`257b6f7` — Stop button for in-flight LLM streams.** `AbortController` threaded through `callLLM` → `callServerStream` (`llm.js`); button appears while `state.busy` is true.
4. **`6ad334a` — Fixed `.chat-bot-label` contrast.** Was `--violet` (#730394) on a light-violet chip background in the AI-in-Action demo, ~1.6:1 contrast (WCAG AA needs 4.5:1 for text this size). Switched to `--violet-l` (#D17DFE), now ~6:1.
5. **`cb3be25` — Fixed `clearScope()` nulling `activeSlideIdx`.** Real bug, found by stress-testing the chat (see below) — details in the commit message.

## Audit findings (this session)

Ran the full three-part audit requested: template-structure adherence, dark-on-dark contrast bugs, and freeform-chat intelligence. Summary below; anything not already fixed above is a documented recommendation, not applied.

### 1. Template-structure adherence — clean

All 12 reference-deck slides visually inspected against the template structure. No structural violations found.

### 2. Contrast — one bug fixed, four lower-severity items documented (not fixed)

Fixed: `.chat-bot-label` (see commit `6ad334a` above).

Not fixed, lower priority / likely intentional — flagging for your call:
- **"How It Works" architecture-diagram badges** — small text at contrast ratios 2.15–4.18:1 depending on badge. Below AA for some.
- **Recurring `rgba(255,255,255,0.35)` white-on-navy caption pattern**, ratio ~3.02:1, appears on multiple slides. Consistent enough across the deck that it looks like a deliberate "muted caption" design choice rather than a bug — but it is technically sub-AA.
- **"Start Here" / "The Path Forward" blue-on-light-blue badges**, ratio 4.18:1 — borderline, just under the 4.5:1 text threshold.
- **"Next Steps" decorative arrows**, ratio 2.56:1 — likely fine since they're non-semantic graphical elements, not text.

Architectural risk (not a bug today, but worth knowing): `applyBrandColors(answers)` overwrites `--sf-navy`/`--sf-blue` with customer-chosen hex values at generation time. `.chat-msg.user` hardcodes white text on a `--sf-blue`-driven background, and the now-fixed `.chat-bot-label` fix is itself a hardcoded light-violet — neither is contrast-checked against whatever the customer picks. If a customer chooses a light accent color, either of these could regress back into a dark-on-light or light-on-light failure. Worth a follow-up: run the existing contrast-enforcement logic against these two rules too, not just the slide content it currently covers.

### 3. Freeform chat intelligence — stress-tested end-to-end, one real bug found and fixed

Verified via live UI interaction (fetch-interception on `/api/llm-stream`, not code inspection) that all reference-matching tiers work: digit ("slide 11"), literal label ("the hero slide"), number-word ("slide two"), ordinal-word ("the third slide").

Found and fixed a real bug (commit `cb3be25`): `clearScope()` was nulling `state.activeSlideIdx` along with `state.scope`, even though freeform chat runs with scope cleared. This meant:
- The final fallback tier (default to the currently-viewed slide when nothing else matches) could never engage — ambiguous freeform messages silently got empty slide context.
- Every freeform edit's post-patch re-render snapped the preview back to slide 0 (Hero), regardless of which slide was actually being edited.

Verified live after the fix: with scope cleared and a message with zero possible keyword/label/digit matches ("this section feels cluttered, can you clean it up?"), the chat correctly resolved context to the slide the user was last looking at.

**Open design question, not a bug**: when a vague keyword genuinely appears on more than one slide (e.g. "swimlane" appears on 3 slides), the matcher correctly refuses to guess and falls through to "currently viewed slide." That's a reasonable default for the common case, but there's no mechanism to ask a clarifying question when the user isn't looking at any of the matching slides. Worth considering for a future pass if this comes up in practice — not urgent.

### Testing-methodology note (not an app bug)

The `preview_click` tool intermittently reported success on `#btn-send` with zero observable effect (no fetch, no DOM change). Root cause not diagnosed — possibly an overlap/coordinate issue with a nearby "Upload logo image" label. Workaround: `preview_eval` with a direct `document.getElementById(...).click()` worked reliably every time. Worth remembering if a future session sees a `preview_click` call that "succeeds" but nothing happens.

## Other things worth knowing

- **Committer identity warning**: git commit produces `Committer: Imran Mansur <imansur@imansur-ltmjh47.internal.salesforce.com>` — hostname-derived. To set a clean author line:
  ```bash
  git config --global user.email "your-email@example.com"
  ```
- **Suspect model ID**: `server.js:23` has `IMAGE_GEN_MODEL = 'gemini-3.1-flash-image'`. Verify this is a live model before relying on `/api/generate-images`.
- **Orphaned worker code**: `worker/worker.js` is dead in 3.0 for LLM traffic, but `/imranAI/track` (analytics) is still live. Do NOT delete the worker directory.
- **`state.interviewActive` never clears**: `interview.js` sets it to `true` on start, `onComplete` never clears it. Not load-bearing for chat routing anymore — low priority cleanup.
- **Local dev testing caveat**: `npx serve` (in `.claude/launch.json`) is a static host — no `/api/llm` backend. To end-to-end test the LLM path locally, run `node server.js` with `GEMINI_API_KEY` in env. Preview via `npx serve` proves DOM/wiring but LLM responses come back as HTML 404 pages.

## Key files (post-commit state)

- **`app.js`** — `sendMessage` routes scoped vs. freeform edits; `extractReferencedSlides` @ ~L781-842 (6-tier matcher); `clearScope` @ ~L177 (fixed); `rerenderPreview` @ ~L134-150; `selectSlide` @ ~L153-175.
- **`index.html`** — chat controls enabled by default. Slide nav ~L841-849.
- **`llm.js`** — turn types: `suggest`, `freeform`, `edit`, `generate`, `progressive`, `finalize`, default. `callLLM` routes to SSE for heavy turns, now with `AbortController` support.
- **`server.js`** — Express + Gemini. `GEMINI_API_KEY` @ L17, tier map @ L27-35. SSE @ L362. Static server + SPA fallback @ L576/L582.
- **`interview.js`** — `InterviewController`.
- **`worker/worker.js`** — analytics-only.
- **`assets/animation-interactions.css`** — `.chat-bot-label` fix @ ~L64.
- **`skill-context/`** — `SKILL.md`, `STYLE-GUIDE.md`, `SLIDE-PRINCIPLES.md`, `sf-composer.html`. Loaded at runtime via `fetch()` by `llm.js:loadSkillContext`.

## Pending user-side actions

- **Push the 5 local commits** (`f34accf` was already on origin; `c46225a` through `cb3be25` are not) — ask before pushing, per standing directive.
- Rotate any GitHub PAT exposed in earlier sessions (flagged previously; carrying forward in case it wasn't done).
- Verify GitHub Pages redeploy picks up the new commits once pushed — typically ~30s after push.
- Decide whether the four documented-but-unfixed contrast items (How It Works badges, the rgba caption pattern, Start Here/Path Forward badges, Next Steps arrows) are worth fixing or are intentional design choices.
- (Optional cleanup) Retire the stale `2.0` folder and the original folder once confident 3.0 is the source of truth.

## What to do next session

If no new bug is reported: push the pending commits (with permission), then decide on the accent-color contrast risk follow-up (extend contrast-enforcement to `.chat-msg.user` and `.chat-bot-label` so they're safe against arbitrary customer accent colors) — that's the highest-leverage remaining item since it's the one risk that could silently reappear per-customer rather than being a fixed, known issue.
