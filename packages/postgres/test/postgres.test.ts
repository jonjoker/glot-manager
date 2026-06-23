import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from '@glot-manager/core';
import { PostgresStore, migrationSQL, type Queryable } from '../src/index.ts';

/**
 * A fake `Queryable` that emulates the table semantics by inspecting the SQL the
 * adapter generates — verifying both the query shape and the round-trip
 * behavior (jsonb merge on conflict) without a real database.
 */
function fakeDb(): Queryable & { seen: string[] } {
  const table = new Map<string, Record<string, unknown>>();
  const seen: string[] = [];

  const query = async (text: string, params: unknown[] = []) => {
    seen.push(text.trim().split(/\s+/).slice(0, 2).join(' '));
    const sql = text.trim();

    if (sql.startsWith('INSERT')) {
      const [key, namespace, valuesJson, sourceLocale, updatedBy] = params as [
        string,
        string,
        string,
        string,
        string | null,
      ];
      const incoming = JSON.parse(valuesJson) as Record<string, string>;
      const existing = table.get(key);
      const merged = { ...(existing?.values as object | undefined), ...incoming };
      const row = {
        key,
        namespace,
        values: merged,
        source_locale: sourceLocale,
        updated_by: updatedBy ?? null,
        updated_at: new Date('2026-01-01T00:00:00Z'),
      };
      table.set(key, row);
      return { rows: [row] };
    }
    if (sql.startsWith('SELECT') && sql.includes('WHERE key = $1')) {
      const row = table.get(params[0] as string);
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith('SELECT') && sql.includes('ANY($1)')) {
      const keys = params[0] as string[];
      return { rows: keys.map((k) => table.get(k)).filter(Boolean) as Record<string, unknown>[] };
    }
    if (sql.startsWith('SELECT')) {
      return { rows: [...table.values()] };
    }
    return { rows: [] };
  };

  return { query, seen } as unknown as Queryable & { seen: string[] };
}

test('upsert inserts then merges jsonb values on conflict', async () => {
  const db = fakeDb();
  const store = new PostgresStore(db);

  const first = await store.upsert({
    key: 'app.title',
    values: { en: 'Dashboard', de: 'Übersicht' },
    sourceLocale: 'en',
    updatedBy: 'user-1',
  });
  assert.equal(first.values.en, 'Dashboard');
  assert.equal(first.namespace, 'app');
  assert.equal(first.updatedBy, 'user-1');
  assert.equal(first.updatedAt, '2026-01-01T00:00:00.000Z');

  // Partial update merges, preserving existing locales.
  const second = await store.upsert({
    key: 'app.title',
    values: { fr: 'Tableau' },
    sourceLocale: 'en',
  });
  assert.equal(second.values.en, 'Dashboard'); // preserved by `||` merge
  assert.equal(second.values.fr, 'Tableau');
});

test('get returns a mapped entry or null', async () => {
  const db = fakeDb();
  const store = new PostgresStore(db);
  await store.upsert({ key: 'a.b', values: { en: 'x' }, sourceLocale: 'en' });

  const entry = await store.get('a.b');
  assert.equal(entry?.values.en, 'x');
  assert.equal(entry?.sourceLocale, 'en');
  assert.equal(await store.get('missing'), null);
});

test('list returns all or a keyed subset', async () => {
  const db = fakeDb();
  const store = new PostgresStore(db);
  await store.upsert({ key: 'a', values: { en: '1' }, sourceLocale: 'en' });
  await store.upsert({ key: 'b', values: { en: '2' }, sourceLocale: 'en' });

  assert.equal((await store.list()).length, 2);
  const subset = await store.list(['a', 'missing']);
  assert.equal(subset.length, 1);
  assert.equal(subset[0]?.key, 'a');
});

test('rejects invalid table/schema identifiers (SQL injection guard)', () => {
  const db = fakeDb();
  assert.throws(() => new PostgresStore(db, { table: 'foo; DROP TABLE users' }), ConfigError);
  assert.throws(() => new PostgresStore(db, { schema: 'pg"; --' }), ConfigError);
});

test('uses a custom schema-qualified table name in queries', async () => {
  const db = fakeDb();
  const store = new PostgresStore(db, { schema: 'app', table: 'i18n' });
  await store.get('x');
  // The captured SQL should reference the quoted, qualified table.
  // (We only stored the first two tokens; assert via a direct query capture.)
  const captured: string[] = [];
  const spy: Queryable = {
    query: async (text, params) => {
      captured.push(text);
      return db.query(text, params);
    },
  };
  await new PostgresStore(spy, { schema: 'app', table: 'i18n' }).get('x');
  assert.match(captured[0]!, /"app"\."i18n"/);
});

test('migrationSQL emits a CREATE TABLE for the configured table', () => {
  const sql = migrationSQL({ schema: 'app', table: 'i18n' });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "app"\."i18n"/);
  assert.match(sql, /values\s+jsonb/);
  assert.match(sql, /key\s+varchar\(512\) PRIMARY KEY/);
  assert.throws(() => migrationSQL({ table: 'bad-name' }), ConfigError);
});
