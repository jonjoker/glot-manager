# Getting started

This guide takes you from zero to editing translations on your live page.

## 1. Install

Glot Manager is split so a frontend repo and a backend repo can install only what they
need. In a single app you'll install both halves:

```bash
# client (browser)
npm install @glot/react

# server (Node / edge)
npm install @glot/server @glot/core
# + a store and a translator:
npm install @glot/postgres @glot/anthropic
```

> **Requirements:** Node ≥ 18 for the published packages. Contributing to the
> repo needs Node ≥ 22.18 (the test runner executes TypeScript directly).

## 2. Create the storage table

With Postgres, run the migration once (or generate the SQL and add it to your
migration tool):

```ts
import { migrate } from '@glot/postgres';
import { pool } from './db';

await migrate(pool); // creates "glot_translations"
```

Prefer no database while you try it out? Use the in-memory store from
`@glot/core` (data is lost on restart):

```ts
import { MemoryStore } from '@glot/core';
const store = new MemoryStore();
```

## 3. Mount the server handler

The handler is the only place your **auth**, **database**, and **LLM key** live.

```ts
// app/api/glot/[...path]/route.ts  (Next.js App Router)
import { createGlotHandler } from '@glot/server';
import { toNextHandler } from '@glot/server/next';
import { PostgresStore } from '@glot/postgres';
import { createAnthropicTranslator } from '@glot/anthropic';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';

const handler = createGlotHandler({
  store: new PostgresStore(pool),
  locales: { locales: ['en', 'de', 'fr', 'it'], defaultLocale: 'en' },
  translator: createAnthropicTranslator(),
  editableKeyPrefixes: ['app', 'marketing'],
  authorize: async (req) => (await getSession(req))?.role === 'admin',
});

export const { GET, PUT, POST } = toNextHandler(handler);
```

Other frameworks: see [server.md](./server.md#adapters).

## 4. Add the provider and `<T>`

```tsx
'use client';
import { GlotProvider, T, EditModeToggle } from '@glot/react';

export function Shell({ isAdmin, messages, children }) {
  return (
    <GlotProvider locale="en" messages={messages} isAdmin={isAdmin}>
      <header>
        {/* renders only for admins */}
        <EditModeToggle />
      </header>
      {children}
    </GlotProvider>
  );
}
```

Wrap any user-facing string you want editable:

```tsx
<h1><T id="app.hero.title">Welcome to Acme</T></h1>
<p><T id="app.hero.subtitle">{t('app.hero.subtitle')}</T></p>
```

`<T>` renders the resolved message (or the `children` you pass as a fallback).
In edit mode it becomes a highlighted, click-to-edit label. Outside edit mode it
adds **nothing** — no wrapper element, no attributes.

### Where do `messages` come from?

From wherever you already load them — next-intl, i18next, a fetched JSON, or the
store itself. Glot Manager doesn't replace your i18n runtime; it sits on top to make the
strings editable. To serve messages straight from the store:

```ts
import { buildMessageTree } from '@glot/core';
const tree = buildMessageTree(await store.list(), 'en');
```

## 5. Try it

1. Sign in as an admin.
2. Toggle **Translation edit mode** (or hold **Alt** to peek).
3. Click a highlighted label → edit each language → **Auto translate** → **Save**.
4. The new copy is live on the next render.

Next: [React client reference](./react.md) · [Server reference](./server.md) ·
[Glossary & context](./glossary-and-context.md).
