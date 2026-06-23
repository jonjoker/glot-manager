# Server handler

`@glot/server` exposes one function, `createGlotHandler`, that returns a standard
Web-Fetch handler: `(request: Request) => Promise<Response>`.

```ts
import { createGlotHandler } from '@glot/server';

const handler = createGlotHandler({
  store, // required — a TranslationStore
  locales, // required — { locales, defaultLocale }
  authorize, // required — your auth check
  translator, // optional — enables "Auto translate"
  // …options below
});
```

## Configuration

| Option                  | Type                                          | Default             | Description                                                                          |
| ----------------------- | --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `store`                 | `TranslationStore`                            | —                   | Where translations are persisted.                                                    |
| `locales`               | `LocaleConfig`                                | —                   | `{ locales: string[], defaultLocale, localeNames? }`.                                |
| `authorize`             | `(req) => boolean \| Principal \| Promise<…>` | —                   | Runs first on **every** request. Falsy → `403`. Throw `UnauthorizedError` for `401`. |
| `translator`            | `Translator`                                  | —                   | Omit to disable auto-translate (endpoint returns `501`, client hides the button).    |
| `context`               | `TranslationContext`                          | —                   | Static domain/style/glossary/tone for the LLM.                                       |
| `contextProvider`       | `(job) => TranslationContext`                 | —                   | Per-request context (e.g. a per-tenant glossary).                                    |
| `editableKeyPrefixes`   | `string[]`                                    | `[]` (all)          | Keys an admin may edit. Set this in production.                                      |
| `keyAliases`            | `KeyAlias[]`                                  | `[]`                | Prefix aliases (e.g. `grid` ↔ `gridConnection`).                                     |
| `usages`                | `UsageProvider \| UsageRegistry`              | `() => []`          | "Used in" data per key.                                                              |
| `basePath`              | `string`                                      | `/api/glot`         | Mount path the handler matches against.                                              |
| `allowedOrigins`        | `string[]`                                    | `[]`                | Extra origins allowed for mutations (same-origin always allowed).                    |
| `disableCsrfProtection` | `boolean`                                     | `false`             | Turn off the built-in CSRF checks (only if a gateway handles it).                    |
| `onChange`              | `(keys: string[]) => void`                    | —                   | Fires after a successful save — invalidate caches / revalidate here.                 |
| `rateLimit`             | `(req, ctx) => { ok, retryAfterSeconds? }`    | —                   | Optional rate limiter; reject with `429`.                                            |
| `logger`                | `Logger`                                      | console (redacting) | Structured, secret-redacting logger.                                                 |

## HTTP API

All routes are relative to `basePath` (default `/api/glot`) and require
authorization. Mutations additionally pass CSRF checks.

| Method | Path                      | Body                                       | Response                                                 |
| ------ | ------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `GET`  | `/config`                 | —                                          | `{ locales, defaultLocale, localeNames, autoTranslate }` |
| `GET`  | `/entries`                | —                                          | `{ entries: EditableEntry[] }`                           |
| `GET`  | `/entries/:key`           | —                                          | `{ entry: EditableEntry }` (empty entry if new)          |
| `PUT`  | `/entries/:key`           | `{ sourceLocale, values }`                 | `{ entry }`                                              |
| `POST` | `/entries/:key/translate` | `{ sourceLocale, values, targetLocales? }` | `{ values, issues? }`                                    |
| `GET`  | `/entries/:key/usages`    | —                                          | `{ usages }`                                             |

`:key` is URL-encoded. Errors are JSON: `{ error: { code, message, details? } }`
with an appropriate status (`400/401/403/404/422/429/501/502`).

## Adapters

The core handler speaks the Fetch standard, so on Next.js App Router, Remix,
Hono, Bun, Deno, and Cloudflare Workers you can use it directly. Thin adapters
bridge the Node-based frameworks:

```ts
// Next.js App Router — app/api/glot/[...path]/route.ts
import { toNextHandler } from '@glot/server/next';
export const { GET, PUT, POST } = toNextHandler(handler);

// Node http
import { createServer } from 'node:http';
import { toNodeHandler } from '@glot/server/node';
createServer(toNodeHandler(handler)).listen(3000);

// Express
import express from 'express';
import { toExpressHandler } from '@glot/server/express';
app.use('/api/glot', toExpressHandler(handler));

// Remix / Hono / Bun / Deno — pass the request straight through
export const action = ({ request }) => handler(request);
```

> The Express adapter works whether or not a body parser ran first (it
> re-serializes `req.body` when present, otherwise reads the raw stream).

## Caching & instant publish

Because the served messages are read at request time, edits are live on the next
render. Wire `onChange` to invalidate your read cache surgically:

```ts
createGlotHandler({
  // …
  onChange: (keys) => keys.forEach((k) => revalidateTag(`glot:${k}`)),
});
```

## Composing your own server

The per-operation functions are exported if you want to build a custom server
(custom routing, GraphQL, RPC): `getConfig`, `listEntries`, `getEntry`,
`saveEntry`, `autoTranslate`, `getUsages`. Each takes a resolved config from
`resolveConfig(options)`.

See also: [Security](./security.md) · [Stores](./stores.md) ·
[Providers](./providers.md).
