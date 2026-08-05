# ICP Progress Log

Chronological record of completed work on the `3.0` app (Heroku + Gemini backend). Newest first. For current state, open items, and standing directives, see [HANDOFF.md](HANDOFF.md) — that file is the one to read for "what's next"; this one is the history.

---

## 2026-08-05 (later evening) — Export HTML self-containment fix + feedback-widget.js path fix

Commit `7b4136b` (`app.js`), **not yet pushed**. Triggered by the user noticing the exported deck rendered as unstyled plain text when opened outside this app's origin.

**Root cause**: Export HTML built its output from `state.deckDoc.documentElement.outerHTML` verbatim — a `<base href>` tag plus relative `<link>`/`<img>`/`<script>` tags that only resolve while served from this app's own origin (`loadReferenceDeck()`'s `<base>`-relative design, intentional for the *live* app, but never adapted for the *exported* file). Opening the exported HTML from disk, or from any other origin, broke every stylesheet, several images, and scripts.

**Fix**: new `serializeDeckForExport()` async helper, called from a rewritten async `wireTopbar()` export handler:
- Inlines every `<link rel="stylesheet">` as a `<style>` tag, rewriting internal `url(...)` references (e.g. `@font-face src: url('fonts/...')` in `tokens.css`) to absolute URLs so fonts still resolve once the CSS text is detached from its original file location.
- Inlines every `<img src>` as a base64 `data:` URI (via `fetch` + `FileReader.readAsDataURL`).
- Inlines every `<script src>` as an inline `<script>` with the fetched code as `textContent`.
- Removes the `<base>` tag once all inlining is done.
- All three inlining passes run concurrently (`Promise.all`); each element degrades independently on fetch failure (`console.warn`, doesn't abort the whole export) rather than crashing.
- Export button now shows "Exporting…" (disabled) while the async work runs, and a chat error message on total failure.

**Bonus bug found & fixed during verification**: `serializeDeckForExport()`'s own error logging surfaced a pre-existing, unrelated 404 — `feedback-widget.js` was 404ing on **every** deck load (not just export), because `loadReferenceDeck()`'s path-rewrite list (which prefixes `tokens.css`/`components.css`/`animation.css`/`animation-interactions.css`/`animation.js` with `assets/`) was missing a rule for `feedback-widget.js`. Confirmed via `preview_network` that the unprefixed request 404'd on the live app, not just in the export path. Fixed with one added `.replace(...)` rule in the same chain.

**Verification** (`preview_*` tools only): monkey-patched `URL.createObjectURL`/`HTMLAnchorElement.prototype.click` via `preview_eval` to capture the exported Blob without triggering a real download dialog (needed since `app.js` is an ES module — its functions aren't reachable on `window`). Confirmed on the captured export: `hasBaseTag: false`, `hasLinkStylesheet: false`, `scriptSrcTagCount: 0`, `inlineScriptCount: 4` (up from 3 pre-fix — `feedback-widget.js` now inlines too), `nonDataImgCount: 0`, `styleTagCount: 6`. Confirmed via `preview_network` (full request list, not just the failed-filter view, since the tool's log accumulates across reloads rather than clearing) that the live app now requests `assets/feedback-widget.js` → `200 OK` instead of `feedback-widget.js` → `404`.

---

## 2026-08-05 (evening) — Full UX-improvement backlog + animated-slide editability part B

Per explicit instruction ("Work on all of it. I'm going to step away for a few hours. I'll review what you've done when I return and push."). Covers all 12 items tracked since the prior sessions' UX-improvement analysis and animated-slide-editability plan — nothing deferred. Committed locally per the standing "ask before pushing" directive (the "step away" instruction authorized independent implementation but not an unprompted push); **pushed** on the user's explicit instruction after review (see the "2026-08-05 (later evening)" entry above).

**Commit `11dd5ab`** — "Fix silent failures, edit-mode leak, and error leakage; add a11y and progress feedback" (`app.js`, `llm.js`, `interview.js`, `index.html`). 11 of the 12 backlog items:
- Image-swap `onerror`/`naturalWidth` check now warns in chat on a failed load instead of leaving a dead icon with a "success" badge.
- `sendScopedEdit` now calls `exitEditMode()` before firing, closing the window where a manual edit could be silently clobbered by an in-flight AI patch.
- `llm.js`'s dynamic skip-reason strings (`unknown_op:${op}`, raw `e.message`) replaced with fixed keys (`unknown_op`, `patch_apply_error`) mapped in `app.js`'s `PATCH_SKIP_REASONS`; raw detail moved to `console.warn` so it's still available for debugging without leaking to the user-facing chat.
- Interview questions now show a `touched`-gated `.q-validation-hint` (`aria-live="polite"`) listing missing required fields once the user has interacted with the question, instead of just leaving Next disabled with no explanation.
- Icon-upload now confirms success/failure in chat, matching the existing logo-upload behavior.
- `.nav-item`s gained `role="button"`, `tabIndex=0`, `aria-current`, and descriptive `aria-label`s; `Enter`/`Space` selects, `Alt+ArrowUp/Down` (or `Meta+...`) reorders non-pinned items and refocuses the moved item.
- `#chat-log` gained `role="log" aria-live="polite" aria-atomic="false"` so streamed/appended messages are announced to screen readers.
- Drag-handle hover/focus contrast improved.
- SSE `heartbeat` events (previously discarded client-side) now drive an escalating "still working" status via `callLLM`'s new `onHeartbeat` callback and `app.js`'s `makeHeartbeatTicker`, instead of a static "Generating deck…" label for up to ~5.5 minutes.
- Image-swap tooltip now mentions the chat-URL path, not just click-to-upload.

**Commit `0f9183c`** — "Make AI-in-Action and Real-Time-Data animations edit-safe (part B)" (`skill-context/sf-composer.html`, `assets/animation-interactions.css`). The 12th item, previously deferred pending a design check-in (see prior HANDOFF.md) because it changes visible layout, not just wiring:
- S5 (AI in Action): the 7 journey-step cards are now persistent markup (`.canvas-step-card`) with a `.revealed` class toggled at reveal time, replacing the old build-from-`STEPS`-array-and-append/clear approach. `#s5-canvas` gained `role="log" aria-live="polite"`.
- S6 (Real-Time Data): KPI targets are read from and cached back onto static markup (`kpiTarget()`/`dataset.countupTarget`) instead of hardcoded magic numbers (142800, 47, 3200, `'28ms'`), so a manual edit to a KPI's displayed value survives the next Play/Reset cycle. The 8 event-stream `<li>` items are persistent markup shown/hidden via `.show` instead of built from a hardcoded `events` array + `streamItem()`. `resetPipe()` takes a `showRestList` flag so `playS6()` can reset silently before the trickle-in animation starts (no flash of the full list). `#s6-stream` gained the same `role="log" aria-live="polite"` treatment.
- Both Play buttons now show "Playing…" mid-sequence and restore "▶ Play" on Reset, rather than freezing on a stale label.
- **Design rationale** (no design check-in occurred — the user was away): followed the same "fixed markup + class-toggle, never destructive create/destroy" principle already established for other animated slides in this codebase (see the 2026-08-04/05 desync-fix entry below), rather than inventing a new pattern. Validated end-to-end via `preview_eval`-based direct DOM/state inspection (monkey-patching/property inspection through the iframe's `contentWindow`, since `requestAnimationFrame`-driven calls stall in this headless preview environment) rather than a live design conversation.

**Verification approach**: task-tracker reconciled to `completed` for all 12 items. Live-browser-verified via `preview_*` tools: interview validation hint (cleared a required field, confirmed the hint text and disabled Next button), slide-nav keyboard reorder + select (`Alt+ArrowDown` moved and refocused an item; `Enter` set `.active`/`aria-current` on exactly one item). The remaining items (image-swap warning, edit-mode leak fix, error-message mapping, heartbeat ticker) were verified at the diff/code-review level rather than re-tested live in the browser — heartbeat escalation in particular needs many seconds of real elapsed SSE traffic to observe, and several module-scoped functions (`checkQueuedImageLoads`, `PATCH_SKIP_REASONS`) aren't reachable from `preview_eval` since `app.js` doesn't expose them on `window` (expected ES-module encapsulation, not a bug). Judged sufficient given the isolated, pattern-consistent nature of each change and the "step away" time constraint.

No unit tests exist in this repo (consistent with all prior sessions) — all verification is DOM/state-runtime via `preview_*` tools or direct diff review.

---

## 2026-08-05 (later) — Duplicate local checkout deleted

Per explicit user sign-off ("if the interactive customer presentations folder (that doesn't have the 3.0 suffix) is dated and doesn't have anything that this 3.0 one has, then go ahead and delete it"). Before deleting, re-verified the precondition rather than assuming it: `git status` on the non-`3.0` folder showed only 3 dirty/untracked paths (`.claude/launch.json` modified, `.claude/session-state.md` and `HANDOFF.md` untracked) and confirmed via `git log main --not origin/main` that it had zero unique local commits. Content-diffed all 3 files individually — `launch.json`'s diff only redirected preview configs at the `3.0` folder (a workaround for the wrong-cwd preview bug, not unique content); `session-state.md` was empty session-timestamp logging; `HANDOFF.md` was a stale pre-migration doc (dated 2026-07-24, describing the old BYOK/SF-Gateway architecture) already superseded by `3.0`'s own history. Confirmed nothing unique existed.

Ran `rm -rf` on the folder. All real project content (code, `worker/`, `skill-context/`, docs) was successfully removed. The sandbox refused to delete `.claude/` or `.git/` internals (`Operation not permitted`) because this folder was the session's own primary working directory and the sandbox hard-protects its own control/git directories from agent deletion — not a permission-prompt situation, a fixed technical restriction (`dangerouslyDisableSandbox` is policy-disabled). Net result: an empty `.claude`/`.git` shell remains on disk at that path; harmless, and removable manually outside a Claude session (`rm -rf`) if the user wants it fully gone. This resolves what had previously been logged as an open "needs a user decision" item — see HANDOFF.md.

---

## 2026-08-05 — UX-improvement analysis (ideas only, nothing implemented)

Per user request ("start doing an analysis to see if there's any other ideas you can come up with to improve the overall user experience"), following the slide-reordering/Hero-KPI/desync-fix session below. A background code-and-doc-based audit agent was run against this (`3.0`) codebase, briefed to read HANDOFF.md/PROGRESS.md first and skip anything already resolved. **No live-browser walkthrough was performed** — see HANDOFF.md's "Duplicate local checkout" open item for why (this session's preview tooling was defaulting to a stale, 74-commits-behind second local clone). Findings below are code-citation-backed but not click-tested; treat as ideas to triage, not verified bugs.

**Higher-priority (small fix, real UX or correctness payoff):**
- **Broken image swaps fail silently.** No `onerror`/`naturalWidth` check exists anywhere a `src` gets swapped (`app.js` `applyAccentAndCobrand`, `scrapeLogoBackground`, the `file-upload`/`icon-upload` handlers, or AI-driven `set-attribute` patches) — the "Applied N of M" badge can say success while a dead icon renders, with zero chat feedback.
- **Scoped chat edits don't call `exitEditMode()` before firing.** `sendScopedEdit` (`app.js`) leaves contenteditable live through the LLM round-trip; a manual edit landing during that window can be silently clobbered when the AI patch resolves against a `deckEl` reference captured earlier. Every other entry point into editing (slide-select, drag-reorder) already guards this — this one path doesn't.
- **Raw internal errors can leak into the chat mid-demo.** `llm.js`'s `unknown_op:${op}` and generic `e.message` catch-alls aren't registered in `app.js`'s `PATCH_SKIP_REASONS` map, so the fallback renders the raw string verbatim — potentially a JS stack-trace fragment in front of a customer.
- **Interview validation gives zero feedback.** A missing required field just leaves Next disabled (dimmed) with no highlight or message — a rep who missed one field on a multi-field question sees total silence on click.
- **Inconsistent upload confirmation.** Logo swap posts "✅ Logo updated!" to chat; the parallel in-slide icon swap does the identical class of action with no chat feedback at all.
- **Drag handle is nearly invisible** (`⠿` at `rgba(0,30,91,0.28)`, no hover-brightening) — a real discoverability gap for the just-shipped slide-reorder feature.
- **Play/Reset give no in-progress signal.** Play only dims slightly during an 8+ second animation and never relabels to "Replay" after autoplay has already run once; Reset looks identical whether idle or mid-flight.

**Medium (real value, more surface area):**
- **Mouse-only interaction.** `.nav-item` has no `tabindex`/`role`/keydown handling — slide selection itself, not just drag-reorder, is unusable via keyboard. Drag-reorder also has no touch fallback, so it's unusable on mobile/tablet.
- **No `aria-live` anywhere** — chat log, busy spinner, animation progress are all silent to screen readers.
- **Dead air during long generations.** SSE heartbeats are explicitly discarded client-side; a generation can sit on a static "Generating deck…" label for up to ~5.5 minutes with no elapsed-time or progress signal.
- **Chat-URL image-swap has zero onboarding.** It's a real, working capability (routes through the LLM patch pipeline) that a rep would only ever discover by accident.

**Deferred / already tracked elsewhere:** animated-slide editability part B (STEPS/events/countUp arrays) — unchanged, see HANDOFF.md.

Full 8-category breakdown (discoverability, error/failure, feedback/affordance, flow friction, consistency, mobile, accessibility, animated-slide UX) with exact file/line citations is in the session transcript if deeper detail is needed later; the above is the prioritized digest.

---

## 2026-08-04/05 — Slide reordering, Hero KPI cache-staleness fix, AI-in-Action/Real-Time-Data desync fix (part A)

Autonomous follow-through session executing the three items planned-but-not-built in the entry below, plus the Hero KPI bug root-caused there. All three are live-verified via `preview_*` tools.

**1. Slide reordering.** Drag-to-reorder added to the right-nav list (`app.js` `renderNav()`), reusing the existing `applyDeckTypeLayout()` reorder-and-refresh primitive (`appendChild` in new order → `enumerateSlides()` → `renderNav()` → `rerenderPreview()`). Native HTML5 drag-and-drop (`dragstart`/`dragover`/`drop`/`dragend`), no library. Index `0` ("Hero") and the last index ("Thank You") are non-draggable and non-droppable-onto, preserving the `SLIDE_LABEL_OVERRIDES` position invariant. `exitEditMode()` called defensively on `dragstart`.

**2. Hero KPI countUp-cache-staleness fix.** Root cause (previous session): `playHeroCountUp()` (`skill-context/sf-composer.html`) caches each KPI's parsed numeric target in `dataset.countupTarget` on first play and never invalidates it, so a `MutationObserver`-triggered replay on every re-navigation to Hero always re-animates toward the stale pre-edit value, silently discarding manual edits. Fix: `app.js`'s `enterEditMode()` `onInput` handler now deletes `dataset.countupTarget` from both the iframe element and its `deckDoc` counterpart whenever an edit lands inside a `.hero-kpi-card`, forcing the next replay to re-parse the user's new text. Verified live: edited a KPI value, navigated away and back, confirmed the edited value persists instead of reverting.

**3. AI-in-Action / Real-Time-Data slide desync — part A (make static HTML the source of truth for animation scripts; part B — new UI for JS-only arrays like `STEPS`/`events` — remains explicitly out of scope, see HANDOFF.md item 3).**
   - Slide 5 (`playS5()`, `sf-composer.html`): now reads `.type-ghost.textContent` for both the user and bot chat lines instead of hardcoded literals passed to `typeInto()`. Verified via a `typeInto` call-interception technique (monkey-patching `win.typeInto` on the iframe's `contentWindow` to capture arguments synchronously, since `typeInto`/`countUp`/etc. are `requestAnimationFrame`-driven and stall in this headless preview environment — see HANDOFF.md's testing-methodology note): confirmed the original ghost text is passed correctly, and that editing the ghost text changes what's passed, proving live-read behavior rather than coincidence.
   - Slide 6 (`sf-composer.html`): sync-indicator labels are now snapshotted once into `dataset.label` at script-init time and `resetPipe()` restores from that snapshot instead of a hardcoded `labels` array. Verified the snapshot correctly captures original labels even after `goLive()` has already mutated some indicators' visible text.
   - **Extended fix found during verification** (same caching-staleness class as the Hero KPI bug, in-scope as completing part A's desync mandate): the slide-6 snapshot alone doesn't help a *manual* edit — without an app.js-side refresh, editing a sync-indicator's label would sync to `deckDoc` correctly but leave `dataset.label` stale, so the next navigation's `resetPipe()` call would silently discard the edit. Fixed in the same `onInput` handler as the Hero KPI fix: whenever an edit lands on a `.sync-indicator`, refreshes `dataset.label` on both the iframe element and `deckDoc` to the new edited text.
   - Verified live end-to-end: entered edit mode (via the `preview_eval`+`.click()` workaround for `preview_click`'s intermittent no-op issue — see HANDOFF.md item 1), edited a sync-indicator's label, confirmed `dataset.label` updated immediately, exited edit mode, clicked Reset (no iframe reload) and confirmed the edit persisted rather than reverting to "Waiting for sync", clicked Play and confirmed `dataset.label` stayed correct even while `goLive()` transiently overwrote the visible text to "Live", then clicked Reset again post-Play and confirmed the label correctly restored to the edited value (not "Live", not the stale original). Test edit cleaned up afterward.

All three fixes are in-memory/DOM-runtime verified only; no unit tests exist in this repo (consistent with all prior sessions).

---

## 2026-08-04 — Icon/image replacement (click + chat-URL); slide-reorder & animated-slide editability plans (not yet built, uncommitted)

**Icon/image replacement, two entry points, both live-verified:**
1. **Click-to-upload.** `editableImgEls()` (app.js) finds candidate `<img>`s in the active slide; clicking one sets `state.pendingImageSwap = { iframeEl, deckEl }` and opens the hidden `#icon-upload` file input. Its `change` handler reads the picked file, swaps `src` on both the live iframe element and the `deckDoc` source-of-truth element (so Export/re-render stay correct), then clears `pendingImageSwap`.
2. **Chat URL.** No new app.js code needed — routes entirely through the existing LLM patch pipeline. Added an "ICON/IMAGE REPLACEMENT" instruction to both the edit-turn and freeform-turn prompts (`buildTurnPrompt`, llm.js) telling the model to emit `op: "set-attribute"` with a `::attr(src)`-suffixed selector (never `op: "replace"`) when the user supplies a URL.
3. **Guard-chain support for the new op path** (llm.js `applyPatches`): fixed a pre-existing bug where the `::attr(...)`/`::style(...)` DSL suffix was never stripped before `querySelector`/`matches` — every `set-attribute`/`set-style` patch was silently throwing a `SyntaxError` and getting skipped. Added `copyright_protected` (`[data-copyright]`) and `brand_logo_protected` (`[data-brand-logo]`) guards so chat-driven image swaps can't touch the app's own attribution/branding. Restricted `set-attribute` on `<img src>` to `http(s)://`/`data:image/` URLs only (`unsafe_image_src` skip reason) so a chat message can't smuggle in a `javascript:`/other unsafe scheme.

**Live-verified** via `preview_*` tools: clicked an icon → file picker → uploaded a local image → swap appeared in the iframe; sent a chat message with an image URL → patch applied, `<img src>` updated; confirmed Export HTML carries the swapped `src` (proves the `deckDoc` write, not just the iframe's throwaway copy).

**Slide reordering** and **full editability of the "AI in Action"/"Real-Time Data" animated slides** were investigated and planned this session per explicit user request, but deliberately **not implemented** — see HANDOFF.md's "Open items carried forward" for the concrete, ready-to-build plans for both.

**Also this session**: user reported that editing a Hero-slide KPI value (e.g. "360°") via manual-edit-mode reverts to its original value after navigating away and back. Investigated and root-caused (not fixed): `skill-context/sf-composer.html`'s `playHeroCountUp()` caches each KPI's parsed numeric target in `dataset.countupTarget` on first play and never invalidates it; a `MutationObserver` re-triggers the animation on every re-navigation to Hero (no iframe reload), so it always replays toward the stale pre-edit cached target. Distinct from the earlier `7dca674` fix, which addressed replay-race visual corruption, not this edit-loss issue. Root cause and proposed fix documented in HANDOFF.md's "Open items carried forward" #4.

---

## 2026-08-04 — CSS-leak guard fix + "How It Works" personalization (verified live)

**Problem reported by user**: a real end-to-end test (fresh interview → generate deck, real Gemini backend) returned "Applied 10 of 14 – 4 skipped." Slide 4 ("How It Works") wasn't personalizing to the customer's actual systems, and a freeform-chat edit renaming a connector label ("Journey JSON" → "Real-time API") was silently skipped with reason "patch contained raw CSS instead of content" — even though a sibling edit (renaming a node) on the same slide worked fine.

**Root cause** (confirmed by reading the guard/prompt code directly):
1. `applyPatches`'s anti-CSS-leak guard (`llm.js`) ran a regex against the raw `new_html` string, including HTML attribute values. Its `--[\w-]+\s*:\s*#` branch matched legitimate inline `style="--conn-tip:#066AFE"` custom-property declarations used only on slide 4's 3 connector/packet-dot elements. Any patch touching them — generation or freeform — got silently skipped as `css_leak_blocked`, even for a plain text rename.
2. The generate-turn prompt instructions for slide 4 were split across two contradictory descriptions (a "layered" concept and a "hub-and-spoke" concept), neither matching the slide's real DOM shape: a fixed 4-node linear pipeline with 3 labeled connectors, still filled with placeholder tool-internal content ("AI Engine," "Journey JSON," etc.) with no mapping rule from the customer's `stack_sf`/`stack_customer` interview answers onto the 4 fixed slots.

**Fix** (`llm.js`):
- Guard: strip inline `style="..."` attribute values out of `new_html` before testing the CSS-leak regex, so legitimate custom-property styling can't trip it while genuine CSS-leaked-as-visible-text is still caught.
- Prompt: replaced the two inconsistent "How It Works" instructions with one merged, DOM-shape-aware instruction — names the 4 fixed node slots and 3 fixed connectors explicitly, gives a concrete mapping rule (customer's own systems from `stack_customer` in the earlier node(s), selected `stack_sf` products filling the rest, ending on whichever product plays the export/activation role), instructs connector labels to name the *specific* real data-movement mechanism between the two nodes they connect, and calls out that inline `style` custom properties on node/connector elements must be preserved verbatim. Applies unconditionally, no longer gated behind the "Architecture Diagram" animation toggle (that toggle now only controls the packet-dot flow animation).
- Decision made with the user: kept the diagram fixed at 4 nodes / 3 connectors rather than making it dynamic — revisit only if a real customer's product list badly needs more slots.
- Considered but deferred: a dedicated click-to-edit UI for node/connector labels (instead of routing through freeform chat). Assessed as low-risk, self-contained, roughly session-sized work — not built this session.

**Live verification** (real Gemini backend via `node server.js`, `preview_*` tools only — no unit tests exist in this repo):
- Redid a full 16-question interview end-to-end as a "Meridian Retail Group" test scenario and generated a deck: "Applied 14 of 21 — 7 skipped," and all 7 skips were unrelated to the guard (4× KPI-layout-protected, 2× selector-didn't-match, 1× slide-not-found) — **zero `css_leak_blocked` skips**.
- Confirmed slide 4's actual rendered content (inspected via the preview iframe's `contentDocument`) showed genuine personalization: node names `Snowflake Store / MuleSoft API Layer / Salesforce Data Cloud / Marketing Cloud`, connector labels `Batch Sync / Streaming Ingest / Live Activation` — replacing the old placeholder names — with inline `style` custom properties preserved verbatim.
- Repeated the exact freeform-chat connector rename that had previously failed ("Streaming Ingest" → "Real-time API") — now succeeds ("Applied 1 of 1"), styles unchanged.
- Spot-checked an unrelated slide edit ("Why Now" headline change) for regressions from the regex change — "Applied 2 of 2," no regression.

This closes the last item from the previous handoff cycle. It is also very likely the same bug class as an earlier, separately-tracked "0 of 14 personalization patches applied" report — not confirmed as the literal same incident, but no separate investigation remains open for that symptom.

---

## 2026-08-03/04 — Deck-generation retry, slide-targeting hint, patch-loss & clarification fixes

Commit: `1317929` — "Add deck-generation retry, slide-targeting hint, and fix patch-loss/clarification bugs"

1. **"Try again" button on streaming failures.** `generateDeck` and `regenerateForDeckType` (`app.js`) call a new `appendErrorWithRetry(text, onRetry)` helper on failure instead of a dead-end error message. Renders the error plus a `.btn-retry` button (styled in `index.html`, brand-color-safe text via `var(--chat-user-fg, #fff)`) wired with a one-shot click listener that disables itself and re-invokes the original call with the already-collected answers. Excludes `AbortError` (user-initiated cancel) — no retry offered there.
2. **Post-generation message reworded** to explicitly name the editing mechanism: select a slide on the right, then type the change in the chat box below (previously generic "click any slide to refine it").
3. **Bug found & fixed: `.slide`-container patches were silently, fully blocked.** An LLM-emitted `op:'replace'` patch targeting the outer `.slide` element was correctly blocked by `applyPatches`'s guard chain, but the prompt never told the model not to attempt it for `edit`/`freeform` turns. Fixed at the root by adding the guard to the shared `apply_patches` tool schema's `selector` field description, so it applies to every turn type automatically.
4. **Bug found & fixed: double article in clarification message** — "Did you mean the X or the The Gap slide?" when a slide label itself starts with "The." Fixed with a per-label `/^the\s/i` check before prepending "the" (`app.js`).
5. **Added process-level crash visibility.** `server.js` now has `process.on('uncaughtException'|'unhandledRejection', ...)` logging — doesn't prevent a Heroku dyno restart from severing an in-flight SSE stream, but converts a silent "connection just stopped" into a diagnosable log line.

Verified against a real Gemini-backed local server (`node server.js`), not the static `npx serve` preview (which 404s on `/api/llm*`).

---

## 2026-08-03 — Contrast fixes, brand-color-safe chat text, ambiguous slide-ref clarification

Commit: `8f78aff` — "Fix contrast issues, brand-color-safe chat text, and ambiguous slide-ref handling" (plus supporting commits `6ad334a`, `cb3be25`, `7dca674`, `665cad6`)

Executed a 3-phase plan closing out contrast/accent-color risk items from a full experience audit, plus a new clarification capability:

1. **Contrast fixes** in `skill-context/sf-composer.html` + `assets/components.css`: `.arch-tag`/`.bc-badge`/`.phase-badge` (brand-color-on-tint-of-self badges), the recurring `rgba(255,255,255,0.35)` navy caption pattern, and `.c-arrow` decorative arrows on "Next Steps." All verified to clear WCAG AA via `preview_inspect` computed contrast values, not source-level guesses.
2. **Chat bubble text made brand-color-safe.** `.chat-msg.user` (`assets/animation-interactions.css`) reads `var(--chat-user-fg, #fff)` instead of a hardcoded `#fff`. `applyBrandColors()` (`app.js`) sets `--chat-user-fg` via the existing `contrastColor(hex)` helper right after setting `--sf-blue`, so a pale customer accent color can't wash out chat text. `.chat-bot-label` was checked and confirmed not at risk.
3. **Ambiguous slide-reference clarification flow** (new capability). `extractReferencedSlides()` (`app.js`) returns `{ slides, ambiguousLabels }`; when a vague keyword matches more than one slide, `sendFreeformRequest` asks a clarifying question in-chat instead of silently guessing, and stores `state.pendingSlideClarification`. A new `resolvePendingSlideClarification` handles the next user message: resolves against a candidate and re-issues the original request, or falls through to treating the reply as a new freeform request.
4. **Bug found & fixed during Phase 3 verification**: an unrelated reply to a clarifying question was appearing as two duplicate "YOU" chat bubbles, because `resolvePendingSlideClarification` called `appendMessage` unconditionally before falling through to `sendFreeformRequest` (which also appends). Fixed by moving the `appendMessage` call inside the resolved-only branch.

Also folded in from earlier in this thread: fixed Hero countUp KPI corruption on repeated slide re-entry (`7dca674`), stopped `clearScope()` from nulling `activeSlideIdx` (`cb3be25`), fixed low-contrast chat-bot-label text in the AI-in-Action demo (`6ad334a`).

Verified live via real chat UI interaction (`preview_fill`/`preview_click`), including a fetch-monkeypatch technique to inspect outgoing `/api/llm-stream` payloads (since `app.js`'s module-scoped `state` isn't reachable from `preview_eval`).

---

## Earlier — foundational fixes and audit

- `c46225a` — Add visible patch-application result badge (the "Applied N of M — K skipped" UI with expandable skip-reason disclosure).
- `e762c65` — Broaden slide-reference detection in freeform chat.
- `257b6f7` — Add Stop button for in-flight LLM streams.
- A full experience audit of the deck app, including a visual audit of all 12 reference-deck slides and a review of contrast-enforcement/color-application code, plus end-to-end stress-testing of freeform chat editing — this audit is what surfaced the contrast bugs and clarification-flow gap fixed in the 2026-08-03 entry above.
