# Stores

A store implements the `TranslationStore` interface from `@glot/core`:

```ts
interface TranslationStore {
  get(key: string): Promise<TranslationEntry | null>;
  list(keys?: string[]): Promise<TranslationEntry[]>;
  upsert(input: UpsertEntryInput): Promise<TranslationEntry>;
}
```

## In-memory (`@glot/core`)

For development, demos, and tests. Not persistent.

```ts
import { MemoryStore } from '@glot/core';

const store = new MemoryStore({
  'app.title': { values: { en: 'Dashboard', de: 'Übersicht' }, sourceLocale: 'en' },
});
```

## Postgres (`@glot/postgres`)

Works with any node-postgres-compatible client (a `pg.Pool`, `pg.Client`, a
pooled connection, or a transaction). `pg` is an optional peer dependency.

```ts
import { Pool } from 'pg';
import { PostgresStore, migrate } from '@glot/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool); // CREATE TABLE IF NOT EXISTS glot_translations …

const store = new PostgresStore(pool, { schema: 'public', table: 'glot_translations' });
```

- `upsert` merges JSONB values (`values || EXCLUDED.values`), so partial saves
  preserve existing locales.
- Table/schema names are validated against a strict identifier pattern (no SQL
  injection through configuration), and all values are passed as parameters.
- Generate the SQL without running it:

```ts
import { migrationSQL } from '@glot/postgres';
console.log(migrationSQL({ table: 'glot_translations' }));
```

Want to manage the schema with Drizzle/Prisma/Kysely instead? Define the table
yourself with the columns above; `PostgresStore` only needs `query(text, params)`.

## Writing your own store

Any database works — implement the three methods. Keep `upsert` idempotent and
treat keys as opaque, case-sensitive strings. A Redis, SQLite, or DynamoDB store
is a few dozen lines. Use the `MemoryStore` source as a reference.

## Row-level security note

If you put the table behind Postgres RLS (admin-only), remember the Glot Manager handler
already enforces admin access in application code — RLS is defense-in-depth, and
your store's client must connect with a role that satisfies the policy.
