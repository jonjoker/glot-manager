# Security

Glot Manager edits live production copy, so the editor is gated in depth. This page is
both a reference and a checklist.

## Authorization is yours — and server-enforced

Glot Manager ships **no** auth scheme. You provide `authorize(request)`; it runs **first
on every request** (including reads), and a falsy return is a `403`.

```ts
createGlotHandler({
  authorize: async (req) => {
    const session = await getSession(req);
    return session?.role === 'admin'; // truthy → allowed
  },
});
```

- Return a principal object (`{ userId }`) to record `updated_by` on saves.
- Throw `new UnauthorizedError()` to return `401` instead of `403`.
- The client `isAdmin` flag only controls UX (whether the toggle renders). It is
  **never** trusted by the server.

## The LLM key never reaches the client

The translator reads its key from server env (`ANTHROPIC_API_KEY` /
`OPENAI_API_KEY`) inside the handler. It is never accepted from the request,
never returned in a response, and the default logger redacts anything that looks
like a key/token/authorization header.

## Editable-key allowlist

Set `editableKeyPrefixes` in production. A save to a key outside the allowlist is
rejected with `400`, so an "editable key" can't be coerced into touching
unrelated config:

```ts
editableKeyPrefixes: ['app', 'marketing']; // only these may be written
```

Keys are also validated structurally and are **prototype-pollution-safe**:
segments like `__proto__`, `prototype`, and `constructor` are rejected, and the
message-tree builder uses null-prototype objects.

## CSRF (no tokens needed)

For state-changing requests (`PUT`/`POST`), the handler:

1. rejects `Sec-Fetch-Site: cross-site` / `same-site` (a browser-set header JS
   cannot forge),
2. requires the `Origin` (when present) to be same-origin or in `allowedOrigins`,
3. requires `Content-Type: application/json` (forces a CORS preflight for
   cross-origin callers, blocking form-based CSRF).

GET requests are exempt (they're side-effect free). If a trusted gateway already
handles CSRF, set `disableCsrfProtection: true`.

## Input validation & SQL

- Request bodies are validated at the edge: locales must be configured, `values`
  must be an object, and unknown locales are dropped before persistence.
- The Postgres store validates table/schema identifiers against
  `^[A-Za-z_][A-Za-z0-9_]*$` and passes all values as bound parameters.

## Rate limiting

Optional, pluggable — especially worth applying to the auto-translate route,
which proxies the LLM:

```ts
createGlotHandler({
  rateLimit: async (req, { userId }) => {
    const ok = await limiter.check(userId ?? clientIp(req));
    return ok ? { ok: true } : { ok: false, retryAfterSeconds: 30 };
  },
});
```

## Logging

The default logger strips CR/LF (log-injection safe) and redacts secret-looking
fields. Provide your own `logger` to route into your platform — redaction is
applied before handoff.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
