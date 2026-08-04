# ICP Progress Log

Chronological record of completed work on the `3.0` app (Heroku + Gemini backend). Newest first. For current state, open items, and standing directives, see [HANDOFF.md](HANDOFF.md) — that file is the one to read for "what's next"; this one is the history.

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
