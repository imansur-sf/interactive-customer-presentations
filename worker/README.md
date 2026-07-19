# ICP Decktools Worker

Cloudflare Worker that proxies chat turns from the Interactive Customer Presentations frontend to an LLM, with the full sf-decktools skill bundled as the system prompt.

## Endpoints

- `POST /decktools/llm` — main endpoint. Interview + slide-edit + suggest + bulk-suggest turns.
- `POST /decktools/track` — pass-through to the existing decktools usage tracker.
- `GET  /health` — liveness check. Also reports which auth path is configured.

## Auth resolution

The Worker supports two upstream shapes:

1. **Salesforce LLM Gateway Express** (OpenAI-compatible `/chat/completions`) — the default for Salesforce users. Set `LLM_GATEWAY_URL` + `LLM_GATEWAY_KEY` as Wrangler secrets.
2. **Anthropic direct** (`/v1/messages`) — for anyone using their own Anthropic key. Set `ANTHROPIC_API_KEY`.

Resolution order when the request has no `Authorization` header:
1. If `LLM_GATEWAY_URL` + `LLM_GATEWAY_KEY` are both set → LLM Gateway (OpenAI shape).
2. Else if `ANTHROPIC_API_KEY` is set → Anthropic direct.
3. Else → 401 `no_api_key`.

BYOK (`Authorization: Bearer <key>`):
- `sk-ant-…` → Anthropic direct with the caller's key.
- Any other `sk-…` → LLM Gateway with the caller's key (still requires `LLM_GATEWAY_URL` on the Worker).

## Deploy — Salesforce LLM Gateway path (default)

```bash
cd worker
npm install
npx wrangler login

# Set the gateway base URL (no trailing slash, no /chat/completions suffix — the Worker appends that itself)
npx wrangler secret put LLM_GATEWAY_URL

# Set the gateway API key (your SF-issued key)
npx wrangler secret put LLM_GATEWAY_KEY

# Optional: comma-separated allowlist of frontend origins
npx wrangler secret put ALLOWED_ORIGINS       # e.g. https://imansur-sf.github.io

npx wrangler deploy
```

Then verify resolution:

```bash
curl -sS https://icp-decktools-llm.<subdomain>.workers.dev/health | jq
```

You should see:

```json
{
  "ok": true,
  "secrets": { "LLM_GATEWAY_URL": true, "LLM_GATEWAY_KEY": true, "ANTHROPIC_API_KEY": false },
  "default_provider": "llm-gateway",
  "default_endpoint": "https://<gateway>/chat/completions"
}
```

## Deploy — Anthropic direct

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

## Request shape

```json
POST /decktools/llm
Authorization: Bearer <optional BYOK key>
Content-Type: application/json

{
  "turn": "generate" | "edit" | "suggest",
  "questionId": "hero-kpis",           // interview / suggest turns
  "slideId": "stack",                  // edit turns
  "userMessage": "...",
  "deckContext": { ... },
  "questionSchema": { ... },           // suggest turns
  "model": "opus" | "sonnet" | "haiku" // optional, default "opus"
}
```

## Model aliases

Client requests pick a model by alias. The Worker maps aliases to concrete IDs — currently pointed at the Sonnet variants SF LLM Gateway Express exposes:

| Alias  | Model ID                          |
|--------|-----------------------------------|
| opus   | claude-sonnet-4-5-20250929        |
| sonnet | claude-sonnet-4-20250514          |
| haiku  | claude-3-5-sonnet-20240620-v1     |

Update `MODELS` in `worker.js` if the gateway exposes new IDs (e.g. Opus 4.8, Sonnet 5).

## Skill context

The Worker imports four text files from `../skill-context/` at build time. They are concatenated into a single system message per call.

- `SKILL.md` — workflow + rules
- `STYLE-GUIDE.md` — brand voice, copy caps, palette
- `SLIDE-PRINCIPLES.md` — per-slide design rules
- `sf-composer.html` — canonical 12-slide reference deck

Prompt caching is not used when routing through LLM Gateway (OpenAI shape doesn't support it). It's still declared for the Anthropic-direct code path.

To update the skill context, edit files in `../skill-context/` and redeploy.
