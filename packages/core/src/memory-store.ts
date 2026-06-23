import type { TranslationEntry, TranslationStore, UpsertEntryInput } from './types.ts';
import { normalizeUpsertInput } from './normalize.ts';

/** Seed data for {@link MemoryStore}: either full entries or a `key → values` map. */
export type MemoryStoreSeed =
  | TranslationEntry[]
  | Record<string, { values: TranslationEntry['values']; sourceLocale?: string }>;

export interface MemoryStoreOptions {
  /** Default source locale for seeded entries that don't specify one. */
  defaultSourceLocale?: string;
  /** Provide a clock for `updatedAt`. Defaults to `() => new Date().toISOString()`. */
  now?: () => string;
}

/**
 * An in-memory {@link TranslationStore}, ideal for local development, demos, and
 * tests. Not persistent — data is lost when the process exits.
 *
 * @example
 * const store = new MemoryStore({
 *   'app.title': { values: { en: 'Dashboard', de: 'Übersicht' } },
 * });
 */
export class MemoryStore implements TranslationStore {
  private readonly entries = new Map<string, TranslationEntry>();
  private readonly defaultSourceLocale: string;
  private readonly now: () => string;

  constructor(seed?: MemoryStoreSeed, options: MemoryStoreOptions = {}) {
    this.defaultSourceLocale = options.defaultSourceLocale ?? 'en';
    this.now = options.now ?? (() => new Date().toISOString());

    if (Array.isArray(seed)) {
      for (const entry of seed) this.entries.set(entry.key, { ...entry });
    } else if (seed) {
      for (const [key, value] of Object.entries(seed)) {
        void this.upsert({
          key,
          values: value.values,
          sourceLocale: value.sourceLocale ?? this.defaultSourceLocale,
        });
      }
    }
  }

  async get(key: string): Promise<TranslationEntry | null> {
    const entry = this.entries.get(key);
    return entry ? { ...entry, values: { ...entry.values } } : null;
  }

  async list(keys?: string[]): Promise<TranslationEntry[]> {
    const source = keys
      ? keys.map((key) => this.entries.get(key)).filter((e): e is TranslationEntry => Boolean(e))
      : [...this.entries.values()];
    return source.map((entry) => ({ ...entry, values: { ...entry.values } }));
  }

  async upsert(input: UpsertEntryInput): Promise<TranslationEntry> {
    const normalized = normalizeUpsertInput(input);
    const existing = this.entries.get(normalized.key);
    const entry: TranslationEntry = {
      key: normalized.key,
      namespace: normalized.namespace,
      values: { ...existing?.values, ...normalized.values },
      sourceLocale: normalized.sourceLocale,
      updatedAt: this.now(),
      updatedBy: normalized.updatedBy ?? null,
    };
    this.entries.set(entry.key, entry);
    return { ...entry, values: { ...entry.values } };
  }

  /** Number of entries currently stored. */
  get size(): number {
    return this.entries.size;
  }

  /** Remove all entries (test helper). */
  clear(): void {
    this.entries.clear();
  }
}
