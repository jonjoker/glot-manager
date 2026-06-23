import type { Locale, LocaleValues, UpsertEntryInput } from './types.ts';
import { namespaceOf } from './key.ts';

/**
 * Normalize a {@link LocaleValues} map: drop `null`/`undefined` and any
 * non-string value, and (optionally) keep only the configured locales. Non-string
 * values are dropped rather than coerced, so an object never becomes the literal
 * `"[object Object]"`. (The server additionally rejects non-string values at the
 * request boundary — this is the last line of defense.)
 */
export function normalizeValues(
  values: LocaleValues | Record<string, unknown>,
  allowedLocales?: readonly Locale[],
): LocaleValues {
  const allow = allowedLocales ? new Set(allowedLocales) : null;
  const out: LocaleValues = {};
  for (const [locale, raw] of Object.entries(values)) {
    if (typeof raw !== 'string') continue;
    if (allow && !allow.has(locale)) continue;
    out[locale] = raw;
  }
  return out;
}

/**
 * Normalize raw upsert input into a consistent shape: derive `namespace` from
 * the key when absent and normalize the values map.
 */
export function normalizeUpsertInput(
  input: UpsertEntryInput,
  allowedLocales?: readonly Locale[],
): Required<Pick<UpsertEntryInput, 'key' | 'namespace' | 'values' | 'sourceLocale'>> & {
  updatedBy?: string | null;
} {
  return {
    key: input.key,
    namespace: input.namespace ?? namespaceOf(input.key),
    values: normalizeValues(input.values, allowedLocales),
    sourceLocale: input.sourceLocale,
    ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
  };
}

/** Merge translated `incoming` values onto `base`, with `incoming` winning. */
export function mergeValues(base: LocaleValues, incoming: LocaleValues): LocaleValues {
  return { ...base, ...normalizeValues(incoming) };
}

/** The target locales for a job: every configured locale except the source. */
export function targetLocalesFor(sourceLocale: Locale, locales: readonly Locale[]): Locale[] {
  return locales.filter((locale) => locale !== sourceLocale);
}
