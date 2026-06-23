/**
 * `@glot-manager/postgres` — a {@link TranslationStore} backed by PostgreSQL.
 *
 * Depends only on a structural `Queryable` (anything with a node-postgres-style
 * `query(text, params)`), so it works with a `pg.Pool`, a `pg.Client`, a pooled
 * connection, or a transaction handle — and is fully unit-testable without a
 * real database. `pg` is an optional peer dependency you bring yourself.
 */

import {
  ConfigError,
  normalizeUpsertInput,
  type LocaleValues,
  type TranslationEntry,
  type TranslationStore,
  type UpsertEntryInput,
} from '@glot-manager/core';

/** A node-postgres-compatible query result. */
export interface QueryResultLike<Row> {
  rows: Row[];
}

/** The minimal surface this adapter needs — satisfied by `pg.Pool`/`pg.Client`. */
export interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResultLike<Row>>;
}

export interface PostgresStoreOptions {
  /** Table name. Default `"glot_translations"`. Must be a valid SQL identifier. */
  table?: string;
  /** Schema name. Default `"public"`. Must be a valid SQL identifier. */
  schema?: string;
}

interface StoredRow {
  key: string;
  namespace: string;
  values: LocaleValues | string | null;
  source_locale: string;
  updated_by: string | null;
  updated_at: Date | string | null;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(name: string, label: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new ConfigError(`Invalid Postgres ${label} "${name}" — must match ${IDENTIFIER}`);
  }
  return name;
}

function parseValues(raw: StoredRow['values'], key: string): LocaleValues {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw) as LocaleValues;
  } catch {
    throw new ConfigError(`Could not parse "values" JSON for key "${key}"`);
  }
}

function mapRow(row: StoredRow): TranslationEntry {
  const values = parseValues(row.values, row.key);
  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at
        ? String(row.updated_at)
        : undefined;
  return {
    key: row.key,
    namespace: row.namespace,
    values,
    sourceLocale: row.source_locale,
    updatedBy: row.updated_by ?? null,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export class PostgresStore implements TranslationStore {
  private readonly db: Queryable;
  private readonly table: string;
  private readonly columns = 'key, namespace, values, source_locale, updated_by, updated_at';

  constructor(db: Queryable, options: PostgresStoreOptions = {}) {
    const schema = assertIdentifier(options.schema ?? 'public', 'schema');
    const table = assertIdentifier(options.table ?? 'glot_translations', 'table');
    this.db = db;
    this.table = `"${schema}"."${table}"`;
  }

  async get(key: string): Promise<TranslationEntry | null> {
    const { rows } = await this.db.query<StoredRow>(
      `SELECT ${this.columns} FROM ${this.table} WHERE key = $1 LIMIT 1`,
      [key],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async list(keys?: string[]): Promise<TranslationEntry[]> {
    const { rows } = keys
      ? await this.db.query<StoredRow>(
          `SELECT ${this.columns} FROM ${this.table} WHERE key = ANY($1) ORDER BY key`,
          [keys],
        )
      : await this.db.query<StoredRow>(`SELECT ${this.columns} FROM ${this.table} ORDER BY key`);
    return rows.map(mapRow);
  }

  async upsert(input: UpsertEntryInput): Promise<TranslationEntry> {
    const normalized = normalizeUpsertInput(input);
    const { rows } = await this.db.query<StoredRow>(
      `INSERT INTO ${this.table} (key, namespace, values, source_locale, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, now())
       ON CONFLICT (key) DO UPDATE SET
         namespace = EXCLUDED.namespace,
         values = ${this.table}.values || EXCLUDED.values,
         source_locale = EXCLUDED.source_locale,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING ${this.columns}`,
      [
        normalized.key,
        normalized.namespace,
        JSON.stringify(normalized.values),
        normalized.sourceLocale,
        normalized.updatedBy ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new ConfigError('Upsert did not return a row');
    return mapRow(row);
  }
}

/** Construct a {@link PostgresStore} (functional alias for `new PostgresStore`). */
export function postgresStore(db: Queryable, options?: PostgresStoreOptions): PostgresStore {
  return new PostgresStore(db, options);
}

/**
 * SQL to create the translations table (and helpful indexes). Run this once as a
 * migration. The `key` column is the primary key; `values` is `jsonb`.
 */
export function migrationSQL(options: PostgresStoreOptions = {}): string {
  const schema = assertIdentifier(options.schema ?? 'public', 'schema');
  const table = assertIdentifier(options.table ?? 'glot_translations', 'table');
  const qualified = `"${schema}"."${table}"`;
  return `CREATE TABLE IF NOT EXISTS ${qualified} (
  key          varchar(512) PRIMARY KEY,
  namespace    varchar(512) NOT NULL DEFAULT '',
  values       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  source_locale varchar(16) NOT NULL DEFAULT 'en',
  updated_by   text,
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "${table}_namespace_idx" ON ${qualified} (namespace);`;
}

/** Run {@link migrationSQL} against the given client. */
export async function migrate(db: Queryable, options?: PostgresStoreOptions): Promise<void> {
  await db.query(migrationSQL(options));
}
