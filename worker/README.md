# ICP imranAI Worker

Analytics-only pass-through Worker for the Interactive Customer Presentations frontend. It no longer proxies any LLM calls — the browser now talks to the Salesforce LLM Gateway directly using a BYOK key stored in localStorage. This Worker just forwards usage-tracking events and exposes a health check.

## Endpoints

- `POST /imranAI/track` — fire-and-forget pass-through to `https://decktools-tracker.mtoolin.workers.dev/track`, dispatched via `ctx.waitUntil`. Responds `202 Accepted` immediately without waiting on the upstream call.
- `GET /health` — liveness check. Returns `{ "ok": true, "ts": "<iso-timestamp>" }`.

Example:

```bash
curl -sS -X POST https://icp-imranai-llm.<subdomain>.workers.dev/imranAI/track \
  -H "Content-Type: application/json" \
  -d '{"event":"turn","props":{}}'
```

The body is opaque — the Worker doesn't inspect or validate it, just relays it to the tracker.

## Config

- `ALLOWED_ORIGINS` — comma-separated allowlist of frontend origins for CORS (e.g. `https://imansur-sf.github.io`), or `*` to allow any origin.

There are no LLM provider secrets on this Worker. The old `LLM_GATEWAY_URL`, `LLM_GATEWAY_KEY`, and `ANTHROPIC_API_KEY` bindings have been removed along with the LLM proxy code path.

## Deploy

```bash
cd worker
npx wrangler deploy
```

The Worker name in `wrangler.toml` is `icp-imranai-llm`.
