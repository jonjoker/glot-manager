# Self-hosting

Glot Manager has no hosted service — it runs entirely inside your app and your database.
This page covers a production deployment.

## 1. Database

Create the table (Postgres example):

```ts
import { migrate } from '@glot/postgres';
await migrate(pool);
```

The table is small (one row per key). Back it up with the rest of your database.
Optionally enable RLS so only an admin role can read/write it (defense-in-depth;
the handler also enforces admin access).

## 2. Environment

```bash
DATABASE_URL=postgres://…
ANTHROPIC_API_KEY=sk-ant-…      # or OPENAI_API_KEY
# OPENAI_API_KEY=sk-…
```

Keys are read **server-side only**. Never expose them to the browser.

## 3. Handler

```ts
const handler = createGlotHandler({
  store: new PostgresStore(pool),
  locales: { locales: ['en', 'de', 'fr', 'it'], defaultLocale: 'en' },
  translator: createAnthropicTranslator(),
  context: {
    /* domain, styleGuide, glossary, tone */
  },
  editableKeyPrefixes: ['app', 'marketing'],
  allowedOrigins: ['https://app.example.com'],
  authorize: async (req) => (await getSession(req))?.role === 'admin',
  onChange: (keys) => keys.forEach((k) => revalidateTag(`glot:${k}`)),
  rateLimit: myLimiter,
});
```

## 4. Serving messages

Read messages from the store at request time and hand them to your i18n runtime
(or to `<GlotProvider messages={…}>`):

```ts
import { buildMessageTree } from '@glot/core';

export async function getMessages(locale: string) {
  return buildMessageTree(await store.list(), locale);
}
```

Cache this read (tagged per key) and bust it in `onChange` so edits are live
immediately without hammering the database.

## 5. Keeping translations healthy in CI

Use the audit function as a CI gate:

```ts
import { auditEntries } from '@glot/core';

const report = auditEntries(await store.list(), { locales: ['en', 'de', 'fr', 'it'] });
if (!report.ok) {
  console.error(report.findings);
  process.exit(1); // fail the build on missing locales / placeholder mismatches
}
```

## Scaling notes

- Reads are cacheable and tiny; the only write path is admin saves.
- The auto-translate route calls the LLM — rate-limit it and consider a cheaper
  model (`claude-haiku-4-5`, `gpt-4.1-mini`) for high volume.
- The editor bundle is code-split and admin-only, so production page weight is
  unaffected.
