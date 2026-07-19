# ICP Decktools Worker

Cloudflare Worker that proxies chat turns from the Interactive Customer Presentations frontend to an LLM, with the full sf-decktools skill bundled as the system prompt.

## Endpoints

- `POST /decktools/llm` — main endpoint. Interview + slide-edit turns.
- `POST /decktools/track` — pass-through to the existing decktools usage tracker.
- `GET  /health` — liveness check.

## Request shape

```json
POST /decktools/llm
Authorization: Bearer <optional BYOK key>
Content-Type: application/json

{
  "turn": "answer" | "edit",
  "questionId": "hero-kpis",           // interview turns only
  "slideId": "stack",                  // edit turns only
  "userMessage": "...",
  "deckContext": { ...answers so far, or current slide HTML... },
  "model": "opus" | "sonnet" | "haiku" // optional, default "opus"
}
```

## Response shape

```json
{
  "message": "Updated the hero KPI cards.",
  "next_question": "connected-stack",   // null if interview done
  "patches": [
    { "slide_id": "hero", "selector": ".hero-kpi-row", "new_html": "..." }
  ],
  "_meta": { "provider": "...", "model": "...", "usage": { ... } }
}
```

## Auth resolution

1. `Authorization: Bearer sk-ant-…` → Anthropic direct.
2. `Authorization: Bearer sk-…` → SF LLM Gateway (requires `LLM_GATEWAY_URL`).
3. No `Authorization` header:
   - If `LLM_GATEWAY_URL` + `LLM_GATEWAY_KEY` are set → LLM Gateway with the server-held key.
   - Else if `ANTHROPIC_API_KEY` is set → Anthropic with the server-held key.
   - Else → 401 `no_api_key`.

## Deploy

```bash
cd worker
npm install
wrangler login

# At least one of these must be set:
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put LLM_GATEWAY_URL       # base URL (no trailing slash)
wrangler secret put LLM_GATEWAY_KEY

# Optional: comma-separated allowlist of frontend origins
wrangler secret put ALLOWED_ORIGINS       # e.g. https://imansur-sf.github.io

wrangler deploy
```

The default Worker URL will look like `https://icp-decktools-llm.<your-subdomain>.workers.dev`. Point the frontend at that URL.

## Local dev

```bash
cd worker
cp .dev.vars.example .dev.vars   # then edit
wrangler dev
```

## Skill context

The Worker imports four text files from `../skill-context/` at build time:

- `SKILL.md` — the workflow + rules the LLM must follow
- `STYLE-GUIDE.md` — brand voice, copy caps, palette
- `SLIDE-PRINCIPLES.md` — per-slide design rules
- `sf-composer.html` — canonical 12-slide reference deck

These are concatenated into one cache-marked system prompt block per call. Prompt caching (5-min TTL) means the first call in a window pays the full cost; subsequent calls in that window get a large discount.

To update the skill context, edit files in `../skill-context/` and redeploy. No code changes needed.
