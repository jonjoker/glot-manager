<div align="center">

# Glot Manager

### In-context, AI-native translation management for any website.

Flip a switch, click any text on your live site, and edit it in every language —
with one-click AI translation that respects your glossary and brand voice.
Changes are saved to **your** database and go live instantly. No SaaS, no JSON
files, no rebuilds.

[![CI](https://img.shields.io/github/actions/workflow/status/jonjoker/glot-manager/ci.yml?branch=main&label=CI)](https://github.com/jonjoker/glot-manager/actions)
[![npm](https://img.shields.io/npm/v/@glot/react?label=%40glot%2Freact)](https://www.npmjs.com/package/@glot/react)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![types: TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)
[![RSC ready](https://img.shields.io/badge/RSC-ready-black.svg)](#frameworks)

</div>

---

## Why Glot Manager

Most localization tools make you choose: a cloud CAT tool your developers don't
control, or a pile of `en.json` / `de.json` files nobody on the content side can
touch. The in-context editors that _do_ let you edit on the page (Tolgee,
Crowdin, Phrase, locize) are SaaS, ship invisible Unicode markers to production,
and need a publish + CDN round-trip before edits appear.

**Glot Manager is the open-source, self-hosted alternative**, and it leans on a strong
LLM for the part machine translation usually gets wrong:

- 🖊️ **Edit on the live page.** An admin-only toggle highlights every
  translatable label. Click one to edit all languages in a popup.
- 🤖 **AI translation that's actually trustworthy.** One button translates from
  your source language into the rest — using your **glossary**, **company style
  guide**, and the **on-page context** of where the string is used. Placeholders
  and ICU/HTML markup are preserved and validated.
- ⚡ **Instant publish.** Edits are written to your database and read at request
  time. They're live on the next render — no rebuild, no CDN TTL.
- 🪶 **Zero-cost in production.** The editor UI is code-split and only loads for
  authorized admins. End users download ~0 KB extra and the DOM contains **no
  invisible markers** (a documented source of bugs in marker-based tools).
- 🔌 **Pluggable everything.** Bring your own auth, database, and LLM. Ships with
  Postgres + in-memory stores and Anthropic + OpenAI providers.
- 🧩 **Framework-agnostic server.** One Web-Fetch handler plugs into Next.js,
  Remix, Hono, Bun, Deno, or — via adapters — Node and Express.

---

## 30-second quickstart

> The two integration points are a **one-line client provider** and a **one-line
> server handler**. Here it is end to end on Next.js (App Router).

**Install** (frontend + backend may be the same app or two repos):

```bash
# client
npm install @glot/react
# server
npm install @glot/server @glot/postgres @glot/anthropic
```

**1. Mount the server handler** — auth, persistence, and the LLM key all stay here:

```ts
// app/api/glot/[...path]/route.ts
import { createGlotHandler } from '@glot/server';
import { toNextHandler } from '@glot/server/next';
import { PostgresStore } from '@glot/postgres';
import { createAnthropicTranslator } from '@glot/anthropic';
import { pool } from '@/lib/db';
import { auth } from '@/lib/auth';

const handler = createGlotHandler({
  store: new PostgresStore(pool),
  locales: { locales: ['en', 'de', 'fr', 'it'], defaultLocale: 'en' },
  translator: createAnthropicTranslator(), // reads ANTHROPIC_API_KEY (server-only)
  editableKeyPrefixes: ['app', 'marketing'],
  authorize: async (req) => (await auth(req))?.role === 'admin',
});

export const { GET, PUT, POST } = toNextHandler(handler);
```

**2. Wrap your app once** and mark editable text with `<T>`:

```tsx
'use client';
import { GlotProvider, T, EditModeToggle } from '@glot/react';

export function App({ isAdmin, messages }) {
  return (
    <GlotProvider locale="en" messages={messages} isAdmin={isAdmin}>
      <header>
        <EditModeToggle />
      </header>
      <h1>
        <T id="app.hero.title">Welcome to Acme</T>
      </h1>
    </GlotProvider>
  );
}
```

That's it. Admins see a toggle; flip it, click the heading, edit every language,
hit **Auto translate**, **Save**. Everyone else sees a normal page.

▶️ **Run the full example:** [`examples/next-app`](./examples/next-app).

---

## How it works

```
            ┌─────────────────────── browser ───────────────────────┐
            │  <GlotProvider> + <T id="…">   ── edit mode (admin) ──▶ │
            │      renders text normally          highlight + click  │
            └───────────────┬───────────────────────────┬───────────┘
                            │ display (your messages)    │ fetch /api/glot/*
                            │                             ▼
                            │                  ┌──────────────────────┐
                            │                  │  createGlotHandler   │
                            │                  │  authorize → CSRF →  │
                            │                  │  validate → store /  │
                            │                  │  translator          │
                            │                  └─────┬──────────┬─────┘
                            │                        │          │
                            ▼                        ▼          ▼
                     (next render)            TranslationStore  Translator
                   edits live instantly       (Postgres / …)   (Claude / GPT)
```

- The client renders text from the `messages` you already pass it (from
  next-intl, i18next, a literal — anything). `<T>` only adds a key and, in edit
  mode, a click target.
- Saving writes to your `TranslationStore` and fires `onChange` so you can
  revalidate caches. Because messages are read at request time, the edit is live
  on the next render.
- The LLM call is **extensible**: a `TranslationContext` (domain, style guide,
  glossary, per-locale tone) is injected into every prompt, and you can override
  the prompt builder or the whole provider.

---

## Packages

| Package                                   | What it's for                                                                                                   | Runtime deps               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [`@glot/core`](./packages/core)           | Framework-agnostic types, ICU/placeholder validation, glossary + context prompt engine, in-memory store, audit. | none                       |
| [`@glot/react`](./packages/react)         | `<GlotProvider>`, `<T>`/`useT`, `<EditModeToggle>`, the code-split editor overlay.                              | react (peer)               |
| [`@glot/server`](./packages/server)       | The Web-Fetch request handler + Next.js / Node / Express adapters.                                              | `@glot/core`               |
| [`@glot/anthropic`](./packages/anthropic) | Claude translation provider (structured output, glossary-aware).                                                | `@anthropic-ai/sdk` (peer) |
| [`@glot/openai`](./packages/openai)       | OpenAI translation provider.                                                                                    | `openai` (peer)            |
| [`@glot/postgres`](./packages/postgres)   | Postgres `TranslationStore` for any node-postgres-compatible client.                                            | `pg` (optional peer)       |
| [`@glot/git`](./packages/git)             | Import language files from a git repo, edit in context, publish changes back as a commit/PR (GitHub + system-git backends). | `@glot/core`               |

---

## Frameworks

The server is a single `(request: Request) => Promise<Response>`. Use it directly
on any Fetch-based runtime, or via a thin adapter:

| Runtime                                    | How                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Next.js** (App Router)                   | `import { toNextHandler } from '@glot/server/next'` → `export const { GET, PUT, POST } = toNextHandler(handler)` |
| **Remix / Hono / Bun / Deno / Cloudflare** | Pass the request straight through: `handler(request)`                                                            |
| **Node `http`**                            | `import { toNodeHandler } from '@glot/server/node'`                                                              |
| **Express**                                | `import { toExpressHandler } from '@glot/server/express'` → `app.use('/api/glot', toExpressHandler(handler))`    |

The React client is React 18/19; it works with any router. Non-React frontends
can talk to the [HTTP API](./docs/server.md#http-api) directly.

---

## The AI translation engine

Glot Manager treats auto-translation as a quality lever, not a checkbox. Every call is
built from an extensible [`TranslationContext`](./docs/glossary-and-context.md):

```ts
createGlotHandler({
  // ...
  translator: createAnthropicTranslator({ model: 'claude-opus-4-8' }),
  context: {
    domain: 'energy management software for grid operators',
    styleGuide: 'Formal, precise. German uses "Sie". Avoid exclamation marks.',
    tone: { de: 'Use the formal "Sie".' },
    glossary: [
      { term: 'curtailment', translations: { de: 'Abregelung', fr: 'écrêtage' } },
      { term: 'PV', doNotTranslate: true },
    ],
  },
  // …or load it per request (e.g. a per-tenant glossary from the DB):
  contextProvider: async (job) => ({ glossary: await loadGlossary(job.key) }),
});
```

The engine selects only the glossary terms present in each string, injects the
domain/style/tone, includes where the string is used, and validates the result —
target text must keep every `{placeholder}`, ICU plural, `%s`, and `<tag>` from
the source. See [docs/glossary-and-context.md](./docs/glossary-and-context.md)
and [docs/providers.md](./docs/providers.md) (incl. writing a custom provider).

---

## Security

Glot Manager is built defense-in-depth (details in [docs/security.md](./docs/security.md)):

- **Auth is yours, and enforced server-side on every request.** The client
  `isAdmin` flag is UX only — the handler's `authorize` is the real gate.
- **The LLM key never leaves the server** and is never echoed in responses/logs.
- **Editable keys are allow-listed** by prefix; writes elsewhere are rejected.
- **CSRF** is blocked via `Sec-Fetch-Site` + `Origin` + JSON content-type checks.
- **Inputs are validated**, keys are **prototype-pollution-safe**, SQL uses
  parameterized queries with validated identifiers, and logs are CR/LF-sanitized.

---

## Documentation

- [Getting started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- [React client](./docs/react.md) · [Server handler](./docs/server.md)
- [Providers & the LLM engine](./docs/providers.md) · [Glossary & context](./docs/glossary-and-context.md)
- [Stores](./docs/stores.md) · [Git sync](./docs/git.md) · [Self-hosting](./docs/self-hosting.md)
- [Security](./docs/security.md) · [FAQ](./docs/faq.md)

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). The whole
monorepo runs locally with `npm install && npm test` (Node ≥ 22.18).

## License

[MIT](./LICENSE) © Glot Manager contributors
