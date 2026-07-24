// Interactive Customer Presentations — analytics tracker Worker
//
// Endpoints:
//   POST /imranAI/track      — fire-and-forget usage tracker pass-through
//   GET  /health             — liveness check
//
// LLM calls used to be proxied through this Worker's /imranAI/llm endpoint.
// That path was removed once the app moved to direct browser-to-SF-LLM-Gateway
// calls (BYOK) — the Worker no longer talks to any LLM provider or gateway.

// ------------------------------------------------------------------ CORS
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allowed.length === 0 || allowed.includes(origin) || allowed.includes('*') ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, { status = 200, request, env } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(request ? corsHeaders(request, env || {}) : {}),
    },
  });
}

// ------------------------------------------------------------------ Router
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, ts: new Date().toISOString() }, { request, env });
    }

    if (url.pathname === '/imranAI/track' && request.method === 'POST') {
      // Fire-and-forget pass-through to the existing decktools tracker.
      try {
        const body = await request.text();
        ctx.waitUntil(
          fetch('https://decktools-tracker.mtoolin.workers.dev/track', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }).catch(() => {})
        );
      } catch (_) {}
      return json({ ok: true }, { request, env });
    }

    return json({ error: 'not_found' }, { status: 404, request, env });
  },
};
