/**
 * Utilities for working with dotted translation keys
 * (e.g. `"selfService.research.options.pvCurtailment"`).
 */

/** Property names that must never be written into a plain object via a key path. */
export const UNSAFE_KEY_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

/** A prefix alias: keys starting with `from` are treated as if they started with `to`. */
export interface KeyAlias {
  from: string;
  to: string;
}

/** The namespace of a key — everything up to (but excluding) the last segment. */
export function namespaceOf(key: string): string {
  const lastDot = key.lastIndexOf('.');
  return lastDot === -1 ? '' : key.slice(0, lastDot);
}

/** The final segment of a key (`"pvCurtailment"` for the example above). */
export function leafOf(key: string): string {
  const lastDot = key.lastIndexOf('.');
  return lastDot === -1 ? key : key.slice(lastDot + 1);
}

/**
 * Split a key into its dotted segments. Empty segments are preserved (e.g.
 * `"a..b"` → `["a", "", "b"]`); callers that require well-formed keys should
 * validate with {@link isValidKey} first.
 */
export function keySegments(key: string): string[] {
  return key.split('.');
}

/**
 * Whether a key is a well-formed dotted key: non-empty, no leading/trailing/
 * double dots, and no segment that would be unsafe to use as an object property.
 */
export function isValidKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  const segments = key.split('.');
  for (const segment of segments) {
    if (segment.length === 0) return false;
    if (UNSAFE_KEY_SEGMENTS.has(segment)) return false;
    if (!/^[A-Za-z0-9_$-]+$/.test(segment)) return false;
  }
  return true;
}

/**
 * Whether `key` may be edited, given a list of allowed prefixes.
 *
 * An empty `allowedPrefixes` array allows every (valid) key. A prefix matches
 * the whole key or a dotted sub-path: prefix `"selfService"` matches
 * `"selfService"` and `"selfService.x"` but not `"selfServiceX"`.
 */
export function isEditableKey(key: string, allowedPrefixes: readonly string[]): boolean {
  if (!isValidKey(key)) return false;
  if (allowedPrefixes.length === 0) return true;
  return allowedPrefixes.some(
    (prefix) => key === prefix || key.startsWith(prefix.endsWith('.') ? prefix : `${prefix}.`),
  );
}

/**
 * Apply prefix aliases to a key, returning its canonical form.
 *
 * The first alias whose `from` matches (as a prefix segment or exact key) wins.
 * This mirrors the codebase's `grid` ↔ `gridConnection` aliasing.
 */
export function applyKeyAliases(key: string, aliases: readonly KeyAlias[]): string {
  for (const { from, to } of aliases) {
    if (key === from) return to;
    const prefix = from.endsWith('.') ? from : `${from}.`;
    if (key.startsWith(prefix)) {
      return to + (to.endsWith('.') ? '' : '.') + key.slice(prefix.length);
    }
  }
  return key;
}
