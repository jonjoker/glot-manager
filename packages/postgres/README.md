# @glot/postgres

PostgreSQL storage adapter for [Glot Manager](https://github.com/jonjoker/glot-manager).
Implements the `TranslationStore` interface against any node-postgres-compatible
client.

```bash
npm install @glot/postgres pg
```

```ts
import { Pool } from 'pg';
import { PostgresStore, migrate } from '@glot/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool); // CREATE TABLE IF NOT EXISTS glot_translations …

const store = new PostgresStore(pool, { table: 'glot_translations' });
```

- Works with a `pg.Pool`, `pg.Client`, a pooled connection, or a transaction —
  anything with `query(text, params)`. `pg` is an **optional** peer dependency.
- `upsert` merges JSONB (`values || EXCLUDED.values`), so partial saves preserve
  existing locales.
- Table/schema names are validated (no SQL injection via config); all values are
  bound parameters.
- `migrationSQL(options)` returns the DDL if you'd rather run it through your own
  migration tool.

📖 Full docs: [Stores guide](https://github.com/jonjoker/glot-manager/blob/main/docs/stores.md) ·
License: MIT
