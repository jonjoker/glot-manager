/**
 * Path-template handling. A `pattern` maps a `(locale, namespace)` pair to a
 * repo-relative file path and back, so the same config drives both export
 * (where to write) and import (how to read a path back into keys).
 *
 * Supported placeholders:
 *   - `{locale}`    — required, e.g. `en`, `pt-BR`.
 *   - `{namespace}` — optional. When present, files are split per namespace and
 *                     the namespace is the **first dotted segment** of a key;
 *                     the remainder is the in-file key path.
 *
 * Examples:
 *   - `messages/{locale}.json`            → one file per locale (next-intl style)
 *   - `locales/{locale}/{namespace}.json` → one file per (locale, namespace) (i18next)
 *   - `src/i18n/{locale}.json`            → custom single-file layout
 */

import { GitConfigError } from './errors.ts';

export interface PathPattern {
  readonly raw: string;
  readonly hasNamespace: boolean;
  /** The static directory prefix before the first placeholder (for listing). */
  readonly listPrefix: string;
}

const PLACEHOLDER = /\{(locale|namespace)\}/g;

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse and validate a path pattern. Throws {@link GitConfigError} when invalid. */
export function parsePattern(raw: string): PathPattern {
  const unknown = raw.replace(PLACEHOLDER, '');
  if (/\{|\}/.test(unknown)) {
    throw new GitConfigError(
      `Path pattern "${raw}" contains an unknown placeholder (only {locale} and {namespace} are allowed)`,
      'invalid_path_pattern',
    );
  }
  if (!raw.includes('{locale}')) {
    throw new GitConfigError(`Path pattern "${raw}" must contain {locale}`, 'invalid_path_pattern');
  }
  if (raw.startsWith('/') || raw.includes('..')) {
    throw new GitConfigError(
      `Path pattern "${raw}" must be a repo-relative path without ".." segments`,
      'invalid_path_pattern',
    );
  }
  const firstBrace = raw.indexOf('{');
  const beforeFirst = raw.slice(0, firstBrace);
  const lastSlash = beforeFirst.lastIndexOf('/');
  return {
    raw,
    hasNamespace: raw.includes('{namespace}'),
    listPrefix: lastSlash === -1 ? '' : beforeFirst.slice(0, lastSlash),
  };
}

/** Build the repo-relative path for a `(locale, namespace)` pair. */
export function formatPath(
  pattern: PathPattern,
  parts: { locale: string; namespace?: string },
): string {
  return pattern.raw.replace(PLACEHOLDER, (_match, name: string) =>
    name === 'locale' ? parts.locale : (parts.namespace ?? ''),
  );
}

/** Parse a repo-relative path back into `{locale, namespace}`, or `null` if it doesn't match. */
export function matchPath(
  pattern: PathPattern,
  path: string,
): { locale: string; namespace?: string } | null {
  const order: string[] = [];
  const segments: string[] = [];
  let lastIndex = 0;
  const finder = new RegExp(PLACEHOLDER.source, 'g');
  for (let match = finder.exec(pattern.raw); match; match = finder.exec(pattern.raw)) {
    segments.push(escapeRegExp(pattern.raw.slice(lastIndex, match.index)), '([^/]+)');
    order.push(match[1] as string);
    lastIndex = match.index + match[0].length;
  }
  segments.push(escapeRegExp(pattern.raw.slice(lastIndex)));

  const matched = new RegExp(`^${segments.join('')}$`).exec(path);
  if (!matched) return null;

  const result: { locale: string; namespace?: string } = { locale: '' };
  order.forEach((name, index) => {
    const value = matched[index + 1];
    if (value === undefined) return;
    if (name === 'locale') result.locale = value;
    else result.namespace = value;
  });
  return result.locale ? result : null;
}

/**
 * Split a dotted key into the namespace (file) it belongs to and the in-file key.
 * Returns `null` when a key cannot be represented in a namespaced layout (a
 * single-segment key has no namespace to live under).
 */
export function splitKey(
  key: string,
  hasNamespace: boolean,
): { namespace?: string; localKey: string } | null {
  if (!hasNamespace) return { localKey: key };
  const dot = key.indexOf('.');
  if (dot <= 0 || dot === key.length - 1) return null; // no namespace, or trailing dot
  return { namespace: key.slice(0, dot), localKey: key.slice(dot + 1) };
}

/** Reconstruct the full dotted key from a namespace + in-file key. */
export function joinKey(namespace: string | undefined, localKey: string): string {
  return namespace ? `${namespace}.${localKey}` : localKey;
}
