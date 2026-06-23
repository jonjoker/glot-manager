import type { Locale, TranslationEntry } from './types.ts';
import { applyKeyAliases, keySegments, UNSAFE_KEY_SEGMENTS, type KeyAlias } from './key.ts';

/** A nested message tree, as consumed by i18n libraries (next-intl, i18next, …). */
export interface MessageTree {
  [segment: string]: string | MessageTree;
}

/**
 * Write `value` into `tree` at the dotted `key` path, creating intermediate
 * objects as needed. Prototype-pollution-safe: unsafe segments are ignored and
 * the function refuses to overwrite an existing string with a branch (or vice
 * versa), preferring the leaf string.
 */
export function setMessageValue(tree: MessageTree, key: string, value: string): void {
  const segments = keySegments(key);
  let node: MessageTree = tree;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined || segment.length === 0 || UNSAFE_KEY_SEGMENTS.has(segment)) {
      return; // Refuse to build an unsafe or malformed path.
    }

    const isLeaf = i === segments.length - 1;
    if (isLeaf) {
      // Only set if we are not clobbering an existing branch.
      if (typeof node[segment] !== 'object') {
        node[segment] = value;
      }
      return;
    }

    const next = node[segment];
    if (typeof next === 'object' && next !== null) {
      node = next;
    } else if (next === undefined) {
      const created: MessageTree = Object.create(null) as MessageTree;
      node[segment] = created;
      node = created;
    } else {
      // A string already occupies this slot; do not turn it into a branch.
      return;
    }
  }
}

export interface BuildMessageTreeOptions {
  /** Prefix aliases applied to each key before insertion. */
  aliases?: readonly KeyAlias[];
  /**
   * When `true`, also insert the un-aliased key, so both spellings resolve.
   * Mirrors serving messages under `grid.*` and `gridConnection.*`.
   */
  keepOriginalAlias?: boolean;
}

/**
 * Assemble a nested {@link MessageTree} for a single locale from flat entries.
 *
 * Entries missing the requested locale are skipped. The result uses
 * null-prototype objects so it is safe to serialize and index by untrusted keys.
 */
export function buildMessageTree(
  entries: readonly TranslationEntry[],
  locale: Locale,
  options: BuildMessageTreeOptions = {},
): MessageTree {
  const tree: MessageTree = Object.create(null) as MessageTree;
  const aliases = options.aliases ?? [];

  for (const entry of entries) {
    const value = entry.values[locale];
    if (typeof value !== 'string') continue;

    const canonical = applyKeyAliases(entry.key, aliases);
    setMessageValue(tree, canonical, value);
    if (options.keepOriginalAlias && canonical !== entry.key) {
      setMessageValue(tree, entry.key, value);
    }
  }

  return tree;
}

/** Read a value out of a {@link MessageTree} by dotted key, or `undefined`. */
export function getMessageValue(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree;
  for (const segment of keySegments(key)) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[segment];
  }
  return typeof node === 'string' ? node : undefined;
}
