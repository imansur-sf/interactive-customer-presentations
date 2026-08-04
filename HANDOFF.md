# ICP Session Handoff (3.0)

Last updated: 2026-08-04. **Read this first — do not re-read prior conversation summaries.** For a detailed history of completed work, see [PROGRESS.md](PROGRESS.md); this file is only current state + what's left.

## Where we are

- **Working directory**: `/Users/imansur/claude/interactive-customer-presentations 3.0` (fresh clone of `imansur-sf/interactive-customer-presentations`).
- **Branch**: `main`.
- **Latest commit**: `4dd48b0` — "Fix CSS-leak guard false positive and personalize How It Works slide" (full details in `PROGRESS.md`'s 2026-08-04 entry). **Not yet pushed** — ask before pushing per standing directive #3 below unless the user's message that turn is itself an explicit push instruction.
- The `2.0` folder and the original `/Users/imansur/claude/interactive-customer-presentations` folder are **STALE** (older BYOK/Anthropic-era architecture, different git history). Do NOT work in them.
- All 21 previously-tracked tasks are complete. No known bugs are pending.

## ⚠️ Unresolved findings — need explicit user decision before touching

1. **`.env.rtf`** — untracked, ~561 bytes, RTF format, sitting in the repo root next to the legitimate `.env`. Almost certainly a stray copy of `GEMINI_API_KEY`. **Not covered by `.gitignore`** (which only lists `.env`/`.env.local`, no wildcard). Do not stage, commit, delete, or display its contents without explicit user sign-off — this survives any future "commit everything" instruction; that phrase should be read as "commit the legitimate feature work," not `git add -A`.
2. **`.claude/worktrees/agent-acde1730d9909942e/`** — an orphaned git worktree (own `.git`, full app copy, ~8.5MB), untracked, left over from an unrelated prior agent run. Not urgent, just repo-hygiene clutter. Safe to `git worktree remove` or delete once confirmed unneeded — but get sign-off first.

Neither has been touched.

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

1. **`.env.rtf` and orphaned worktree sign-off** — see flagged section above.
2. **Rotate any GitHub PAT exposed in earlier sessions** — flagged in at least two prior handoffs, status still unconfirmed. Keep raising this until explicitly resolved.
3. **Verify GitHub Pages redeploy** picks up the latest pushed commit — typically ~30s after push, not independently confirmed recently.
4. **Retire the stale `2.0` folder and the original folder** once confident `3.0` is the definitive source of truth — still not done, still optional.
5. **`state.interviewActive` never clears** (`interview.js` sets it `true` on start, `onComplete` never clears it) — not load-bearing, low-priority cleanup.
6. **Suspect model ID**: `server.js` — `IMAGE_GEN_MODEL = 'gemini-3.1-flash-image'`. Still unverified as a live model name.
7. **Testing-methodology note**: `preview_click` has intermittently reported success on a target with zero observable effect in past sessions (suspected coordinate/overlap issue). Workaround if it recurs: `preview_eval` with `document.getElementById(...).click()`.

## What to do next session

1. Get a decision on `.env.rtf` and the orphaned worktree (item 1 above) — raise this before doing anything else that touches git state.
2. Confirm GitHub Pages redeploy picked up the latest commit.
3. Rotate the previously-flagged GitHub PAT if that still hasn't happened.
4. Decide whether to retire the stale `2.0`/original folders.
5. No known bugs are pending from prior work — treat new sessions as fresh feature/polish requests unless a new bug report comes in. If one does and the reason string is `css_leak_blocked` or `slide_element_protected`, re-check `llm.js`'s guard chain first since those are the two guards with known false-positive history.

## Key files

- **`app.js`** — `appendErrorWithRetry`, `generateDeck`/`regenerateForDeckType` retry wiring, `extractReferencedSlides`/`sendFreeformRequest`/`resolvePendingSlideClarification` (ambiguous-slide clarification), `applyBrandColors`/`contrastColor` (brand-color-safe chat text).
- **`llm.js`** — `buildTurnPrompt` (all per-slide generation guidance, including the "How It Works" 4-node/3-connector mapping rule), `applyPatches` (guard chain: `slide_not_found` → `selector_no_match` → `cobrand_logo_protected` → `css_leak_blocked` → `slide_element_protected` → `root_element_protected` → `kpi_layout_protected` → `hero_structure_protected` → more).
- **`index.html`** — `.btn-retry` CSS block; too large to slurp, use chunked reads.
- **`server.js`** — Express + Gemini routes, tier map, SSE handler, `process.on('uncaughtException'|'unhandledRejection', ...)` crash logging, static/SPA fallback.
- **`interview.js`** — `InterviewController`, `stack_sf`/`stack_customer` question definitions.
- **`worker/worker.js`** — analytics-only, unchanged across recent sessions.
- **`.claude/launch.json`** — `icp-local-gemini` runs `node server.js` with `.env` sourced, for any live-LLM verification; `icp` remains static-only.
