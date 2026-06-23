# @glot/server

The framework-agnostic server handler for [Glot Manager](https://github.com/jonjoker/glot-manager).
`createGlotHandler` returns a standard Web-Fetch handler —
`(request: Request) => Promise<Response>` — that gates auth, persists edits, and
proxies the LLM (keeping the key server-side).

```bash
npm install @glot/server @glot/core
```

```ts
import { createGlotHandler } from '@glot/server';
import { toNextHandler } from '@glot/server/next';

const handler = createGlotHandler({
  store, // a TranslationStore (@glot/postgres, MemoryStore, …)
  locales: { locales: ['en', 'de', 'fr', 'it'], defaultLocale: 'en' },
  translator, // optional (@glot/anthropic, @glot/openai, …)
  editableKeyPrefixes: ['app', 'marketing'],
  authorize: async (req) => (await getSession(req))?.role === 'admin',
});

export const { GET, PUT, POST } = toNextHandler(handler);
```

- **Auth is injected** and enforced on every request. **CSRF**, **editable-key
  allowlist**, input validation, sanitized logging, and an optional **rate
  limiter** are built in.
- **Adapters** as subpaths: `@glot/server/next`, `@glot/server/node`,
  `@glot/server/express`. On Remix/Hono/Bun/Deno, pass the request straight
  through.
- `onChange` fires after a save so you can revalidate caches — edits go live on
  the next render (no rebuild, no CDN wait).

📖 Full docs: [Server guide](https://github.com/jonjoker/glot-manager/blob/main/docs/server.md) ·
License: MIT
