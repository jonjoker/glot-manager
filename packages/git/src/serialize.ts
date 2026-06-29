/**
 * Serialization between Glot Manager's flat {@link TranslationEntry} model and
 * the nested per-locale JSON files that i18n runtimes (next-intl, i18next,
 * react-i18next, FormatJS, Vue I18n, …) read.
 *
 * The nesting reuses core's {@link setMessageValue} (the same prototype-safe,
 * `keySegments`-based logic the runtime consumes), so this module is the exact
 * inverse of core's `buildMessageTree`. Formatting is tuned for clean git
 * diffs: 2-space indent, exactly one trailing newline, UTF-8 with no BOM, and
 * never escaping printable non-ASCII (`Grüezi`/emoji stay literal).
 */

import {
  namespaceOf,
  setMessageValue,
  type Locale,
  type LocaleConfig,
  type LocaleValues,
  type MessageTree,
  type TranslationEntry,
  type UpsertEntryInput,
} from '@glot-manager/core';
import { GitSyncError } from './errors.ts';
import { formatPath, joinKey, matchPath, splitKey, type PathPattern } from './paths.ts';
import type { FileChange } from './types.ts';

export interface SerializeOptions {
  /** Indentation passed to `JSON.stringify`. Default `2`. */
  indent: number | string;
  /** Append exactly one trailing newline. Default `true`. */
  trailingNewline: boolean;
  /**
   * `"source"` preserves the order keys first appear in `entries` (related keys
   * stay grouped, new keys append near siblings); `"alpha"` sorts every object
   * by code unit for a fully canonical file. Default `"source"`.
   *
   * Note: purely integer-like sibling segments (`items.0`, `items.10`) are
   * emitted in numeric-ascending order regardless of this setting, per JS object
   * key ordering. The merge path re-parses the existing file first, so output is
   * stable and idempotent after the first write.
   */
  keyOrder: 'source' | 'alpha';
  /**
   * What to write for a key that has no string in a target locale. `"omit"`
   * (default) leaves the key out and lets the runtime's fallback resolve it;
   * `"empty"` writes `""` as a "needs translation" marker.
   */
  missingLocale: 'omit' | 'empty';
}

export const DEFAULT_SERIALIZE_OPTIONS: SerializeOptions = {
  indent: 2,
  trailingNewline: true,
  keyOrder: 'source',
  missingLocale: 'omit',
};

/** Fill in defaults for partial {@link SerializeOptions}. */
export function resolveSerializeOptions(options?: Partial<SerializeOptions>): SerializeOptions {
  return { ...DEFAULT_SERIALIZE_OPTIONS, ...options };
}

function sortTreeKeys(tree: MessageTree): MessageTree {
  const out: MessageTree = {};
  for (const key of Object.keys(tree).sort()) {
    const value = tree[key];
    out[key] = value !== null && typeof value === 'object' ? sortTreeKeys(value) : (value as string);
  }
  return out;
}

/**
 * Serialize a {@link MessageTree} to a JSON string with stable, minimal-diff
 * formatting. Pass `sortKeys` to canonicalize key order recursively.
 */
export function stringifyMessageTree(
  tree: MessageTree,
  options: { indent?: number | string; trailingNewline?: boolean; sortKeys?: boolean } = {},
): string {
  const value = options.sortKeys ? sortTreeKeys(tree) : tree;
  const json = JSON.stringify(value, null, options.indent ?? 2);
  return options.trailingNewline === false ? json : `${json}\n`;
}

/** Parse a locale file's JSON, with a friendly error for malformed input. */
export function parseMessageTree(json: string, label = 'locale file'): MessageTree {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new GitSyncError(`Invalid JSON in ${label}: ${(error as Error).message}`, {
      code: 'invalid_locale_file',
      status: 422,
      cause: error,
    });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GitSyncError(`A ${label} must contain a JSON object at the top level`, {
      code: 'invalid_locale_file',
      status: 422,
    });
  }
  return parsed as MessageTree;
}

export interface FlattenResult {
  /** Flat `dottedKey → string` map (the inverse of nesting). */
  values: Record<string, string>;
  /** Dotted keys whose leaf was not a string (arrays, numbers, …) and were skipped. */
  skipped: string[];
}

/** Flatten a nested message object into dotted keys; only string leaves are kept. */
export function flattenMessageTree(tree: unknown): FlattenResult {
  const values: Record<string, string> = {};
  const skipped: string[] = [];

  const walk = (node: unknown, prefix: string): void => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [segment, child] of Object.entries(node as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${segment}` : segment;
      if (typeof child === 'string') values[key] = child;
      else if (child !== null && typeof child === 'object' && !Array.isArray(child)) walk(child, key);
      else skipped.push(key);
    }
  };

  walk(tree, '');
  return { values, skipped };
}

/** The distinct namespaces present in `entries`, plus keys that can't be represented. */
export function collectNamespaces(
  entries: readonly TranslationEntry[],
  hasNamespace: boolean,
): { namespaces: (string | undefined)[]; unrepresentable: string[] } {
  if (!hasNamespace) return { namespaces: [undefined], unrepresentable: [] };
  const namespaces = new Set<string>();
  const unrepresentable: string[] = [];
  for (const entry of entries) {
    const split = splitKey(entry.key, true);
    if (!split || split.namespace === undefined) unrepresentable.push(entry.key);
    else namespaces.add(split.namespace);
  }
  return { namespaces: [...namespaces].sort(), unrepresentable };
}

/**
 * Build the nested tree for one `(locale, namespace)` file from `entries`.
 * Honors `keyOrder` (insertion order is the caller's iteration order) and
 * `missingLocale`.
 */
export function buildLocaleTree(
  entries: readonly TranslationEntry[],
  locale: Locale,
  pattern: PathPattern,
  namespace: string | undefined,
  options?: Partial<SerializeOptions>,
): MessageTree {
  const opts = resolveSerializeOptions(options);
  const ordered =
    opts.keyOrder === 'alpha'
      ? [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      : entries;
  const tree: MessageTree = Object.create(null) as MessageTree;

  for (const entry of ordered) {
    const split = splitKey(entry.key, pattern.hasNamespace);
    if (!split) continue;
    if (pattern.hasNamespace && split.namespace !== namespace) continue;
    const value = entry.values[locale];
    if (typeof value === 'string') setMessageValue(tree, split.localKey, value);
    else if (opts.missingLocale === 'empty') setMessageValue(tree, split.localKey, '');
  }
  return tree;
}

/** Whether a tree has any leaves (used to skip writing empty files). */
function treeIsEmpty(tree: MessageTree): boolean {
  for (const _key in tree) return false;
  return true;
}

/**
 * Render the full set of locale files from `entries` (a fresh, deterministic
 * build). Empty `(locale, namespace)` files are omitted rather than written
 * blank. This is the basis for prune/full-rebuild publishes.
 */
export function entriesToFiles(
  entries: readonly TranslationEntry[],
  locales: LocaleConfig,
  pattern: PathPattern,
  options?: Partial<SerializeOptions>,
): FileChange[] {
  const opts = resolveSerializeOptions(options);
  const { namespaces } = collectNamespaces(entries, pattern.hasNamespace);
  const files: FileChange[] = [];

  for (const locale of locales.locales) {
    for (const namespace of namespaces) {
      const tree = buildLocaleTree(entries, locale, pattern, namespace, opts);
      if (treeIsEmpty(tree)) continue;
      files.push({
        path: formatPath(pattern, { locale, namespace }),
        content: stringifyMessageTree(tree, {
          indent: opts.indent,
          trailingNewline: opts.trailingNewline,
          sortKeys: opts.keyOrder === 'alpha',
        }),
      });
    }
  }
  return files;
}

/**
 * Parse locale files back into flat {@link UpsertEntryInput} rows — one row per
 * key carrying every locale that has a string for it. Unparseable files and
 * non-string leaves are reported as warnings rather than thrown.
 */
export function filesToEntries(
  files: readonly FileChange[],
  pattern: PathPattern,
  sourceLocale: Locale,
): { entries: UpsertEntryInput[]; warnings: string[] } {
  const byKey = new Map<string, LocaleValues>();
  const warnings: string[] = [];

  for (const file of files) {
    if (file.content === null) continue;
    const matched = matchPath(pattern, file.path);
    if (!matched) continue;

    let tree: MessageTree;
    try {
      tree = parseMessageTree(file.content, file.path);
    } catch (error) {
      warnings.push((error as Error).message);
      continue;
    }

    const { values, skipped } = flattenMessageTree(tree);
    for (const key of skipped) {
      warnings.push(`Skipped non-string value at "${joinKey(matched.namespace, key)}" in ${file.path}`);
    }
    for (const [localKey, value] of Object.entries(values)) {
      const fullKey = joinKey(matched.namespace, localKey);
      const existing = byKey.get(fullKey) ?? {};
      existing[matched.locale] = value;
      byKey.set(fullKey, existing);
    }
  }

  const entries: UpsertEntryInput[] = [...byKey.entries()]
    .map(([key, values]) => ({ key, namespace: namespaceOf(key), values, sourceLocale }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { entries, warnings };
}
