/**
 * The pure planning core shared by `status` (read-only) and `publish` (commits
 * the result). Given a candidate snapshot of entries and the files currently in
 * the repo, it computes the exact files that must be written and a key-level
 * diff — with no I/O, so it is trivially testable.
 *
 * Default behavior is a **content-level targeted merge**: only the keys in
 * scope are set onto the *current* file content, preserving key order and any
 * keys another writer added concurrently. `prune` switches to a full rebuild
 * that also removes keys absent from the candidate.
 */

import {
  getMessageValue,
  setMessageValue,
  type LocaleConfig,
  type LocaleValues,
  type MessageTree,
  type TranslationEntry,
} from '@glot-manager/core';
import { GitConfigError } from './errors.ts';
import { formatPath, matchPath, splitKey, type PathPattern } from './paths.ts';
import {
  buildLocaleTree,
  flattenMessageTree,
  parseMessageTree,
  resolveSerializeOptions,
  stringifyMessageTree,
  type SerializeOptions,
} from './serialize.ts';
import type { FileChange, TranslationDiff } from './types.ts';

export interface PlanOptions {
  /** Restrict the publish to these keys (the dirty set). `null` = all candidate keys. */
  scope?: readonly string[] | null;
  /** Remove keys present in the repo but absent from the candidate. Default `false`. */
  prune?: boolean;
  serialize?: Partial<SerializeOptions>;
}

function treeIsEmpty(tree: MessageTree): boolean {
  for (const _key in tree) return false;
  return true;
}

/** Whether the candidate's values differ from the current values for any locale it carries. */
function valuesDiffer(candidate: LocaleValues, current: LocaleValues | undefined): boolean {
  if (!current) return true;
  for (const [locale, value] of Object.entries(candidate)) {
    if (typeof value === 'string' && current[locale] !== value) return true;
  }
  return false;
}

function namespacesOfPaths(paths: Iterable<string>, pattern: PathPattern): Set<string | undefined> {
  const out = new Set<string | undefined>();
  for (const path of paths) {
    const matched = matchPath(pattern, path);
    if (matched) out.add(matched.namespace);
  }
  return out;
}

/**
 * Compute the files to write and the key-level diff to apply `candidate` onto
 * the repo represented by `currentFiles`. Pure — no I/O.
 */
export function planPublish(
  candidate: readonly TranslationEntry[],
  currentFiles: readonly FileChange[],
  locales: LocaleConfig,
  pattern: PathPattern,
  options: PlanOptions = {},
): TranslationDiff {
  const opts = resolveSerializeOptions(options.serialize);
  const prune = options.prune ?? false;
  const scope = options.scope ?? null;
  // Pruning means "the candidate is the complete desired state — remove anything
  // else." Scoping to a subset of keys contradicts that and would silently drop
  // out-of-scope keys, so the combination is rejected rather than mis-applied.
  if (prune && scope) {
    throw new GitConfigError(
      'prune cannot be combined with a scoped publish (changedKeys); prune reconciles the full snapshot',
      'invalid_config',
    );
  }
  const scopeSet = scope ? new Set(scope) : null;
  const sortKeys = opts.keyOrder === 'alpha';

  // Index the current repo state.
  const currentContent = new Map<string, string>();
  for (const file of currentFiles) {
    if (file.content !== null) currentContent.set(file.path, file.content);
  }
  const currentByKey = new Map<string, LocaleValues>();
  for (const file of currentFiles) {
    if (file.content === null) continue;
    const matched = matchPath(pattern, file.path);
    if (!matched) continue;
    const tree = parseMessageTree(file.content, file.path);
    for (const [localKey, value] of Object.entries(flattenMessageTree(tree).values)) {
      const key = matched.namespace ? `${matched.namespace}.${localKey}` : localKey;
      const values = currentByKey.get(key) ?? {};
      values[matched.locale] = value;
      currentByKey.set(key, values);
    }
  }

  // Index the candidate, dropping keys that cannot live in a namespaced layout.
  const candByKey = new Map<string, LocaleValues>();
  for (const entry of candidate) {
    if (pattern.hasNamespace && !splitKey(entry.key, true)) continue;
    candByKey.set(entry.key, entry.values);
  }

  // Determine the files that could be affected.
  const candNamespaces = new Set<string | undefined>();
  for (const key of candByKey.keys()) {
    const split = splitKey(key, pattern.hasNamespace);
    candNamespaces.add(split?.namespace);
  }
  const allNamespaces = new Set<string | undefined>([
    ...candNamespaces,
    ...namespacesOfPaths(currentContent.keys(), pattern),
  ]);

  const changedFiles: FileChange[] = [];
  for (const locale of locales.locales) {
    for (const namespace of allNamespaces) {
      const path = formatPath(pattern, { locale, namespace });
      const current = currentContent.get(path) ?? null;
      const desired = prune
        ? renderPruned(candidate, locale, pattern, namespace, opts, sortKeys)
        : renderMerged(candByKey, current, locale, pattern, namespace, scopeSet, opts, sortKeys);
      if (desired !== current) changedFiles.push({ path, content: desired });
    }
  }

  // Key-level categorization.
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  const keysToCategorize = scope ? scope.filter((k) => candByKey.has(k) || currentByKey.has(k)) : [...candByKey.keys()];

  for (const key of keysToCategorize) {
    if (!candByKey.has(key)) {
      if (currentByKey.has(key)) removed.push(key);
      continue;
    }
    if (!currentByKey.has(key)) added.push(key);
    else if (valuesDiffer(candByKey.get(key)!, currentByKey.get(key))) modified.push(key);
    else unchanged.push(key);
  }
  if (!scope) {
    for (const key of currentByKey.keys()) {
      if (!candByKey.has(key)) removed.push(key);
    }
  }

  return {
    added,
    modified,
    removed,
    unchanged,
    changedFiles,
    isClean: changedFiles.length === 0,
    summary: {
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      files: changedFiles.length,
    },
  };
}

function renderPruned(
  candidate: readonly TranslationEntry[],
  locale: string,
  pattern: PathPattern,
  namespace: string | undefined,
  opts: SerializeOptions,
  sortKeys: boolean,
): string | null {
  const tree = buildLocaleTree(candidate, locale, pattern, namespace, opts);
  if (treeIsEmpty(tree)) return null;
  return stringifyMessageTree(tree, { indent: opts.indent, trailingNewline: opts.trailingNewline, sortKeys });
}

function renderMerged(
  candByKey: Map<string, LocaleValues>,
  current: string | null,
  locale: string,
  pattern: PathPattern,
  namespace: string | undefined,
  scopeSet: Set<string> | null,
  opts: SerializeOptions,
  sortKeys: boolean,
): string | null {
  const base: MessageTree = current ? parseMessageTree(current, `${locale} locale file`) : (Object.create(null) as MessageTree);
  for (const [key, values] of candByKey) {
    if (scopeSet && !scopeSet.has(key)) continue;
    const split = splitKey(key, pattern.hasNamespace);
    if (!split || (pattern.hasNamespace && split.namespace !== namespace)) continue;
    const value = values[locale];
    if (typeof value === 'string') setMessageValue(base, split.localKey, value);
    // Only write the "needs translation" marker for keys genuinely absent in
    // this locale — never overwrite an existing repo translation with "".
    else if (opts.missingLocale === 'empty' && getMessageValue(base, split.localKey) === undefined) {
      setMessageValue(base, split.localKey, '');
    }
  }
  if (treeIsEmpty(base)) return current === null ? null : current;
  return stringifyMessageTree(base, { indent: opts.indent, trailingNewline: opts.trailingNewline, sortKeys });
}
