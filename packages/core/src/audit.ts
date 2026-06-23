import type { Locale, TranslationEntry } from './types.ts';
import { diffTokens } from './validation.ts';
import { leafOf } from './key.ts';

export interface AuditOptions {
  /** Every locale that should be present. */
  locales: Locale[];
  /**
   * Order in which to look for the source text when an entry's `sourceLocale`
   * value is empty. Defaults to `[entry.sourceLocale, defaultLocale, ...rest]`.
   */
  sourceFallback?: Locale[];
  /** Flag target values identical to the source. Default `true`. */
  flagSuspiciousCopies?: boolean;
}

export type AuditFindingCode =
  | 'missing_source'
  | 'missing_locale'
  | 'token_mismatch'
  | 'suspicious_copy'
  | 'duplicate_key'
  | 'key_collision';

export interface AuditFinding {
  code: AuditFindingCode;
  severity: 'error' | 'warning';
  key: string;
  locale?: Locale;
  message: string;
}

export interface AuditReport {
  findings: AuditFinding[];
  errorCount: number;
  warningCount: number;
  ok: boolean;
}

/**
 * Audit a set of entries for consistency problems: missing source/target text,
 * placeholder & markup mismatches, suspicious copies, duplicate keys, and
 * parent/leaf key collisions (a key that is also a namespace prefix of another).
 *
 * This is the library form of the codebase's `audit-ui-translations` script and
 * is suitable for a CI gate.
 */
export function auditEntries(
  entries: readonly TranslationEntry[],
  options: AuditOptions,
): AuditReport {
  const findings: AuditFinding[] = [];
  const flagCopies = options.flagSuspiciousCopies ?? true;

  // Duplicate keys.
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      findings.push({
        code: 'duplicate_key',
        severity: 'error',
        key: entry.key,
        message: `Duplicate key "${entry.key}"`,
      });
    }
    seen.add(entry.key);
  }

  // Parent/leaf collisions: a key that is also a strict prefix of another key.
  const keys = [...seen];
  for (const key of keys) {
    const prefix = `${key}.`;
    const collidesWith = keys.find((other) => other !== key && other.startsWith(prefix));
    if (collidesWith) {
      findings.push({
        code: 'key_collision',
        severity: 'error',
        key,
        message: `Key "${key}" is also a namespace prefix of "${collidesWith}"`,
      });
    }
  }

  for (const entry of entries) {
    const fallbackOrder = options.sourceFallback ?? [entry.sourceLocale, ...options.locales];
    const sourceText =
      fallbackOrder.map((locale) => entry.values[locale]).find((v) => v && v.trim().length > 0) ??
      '';

    if (sourceText.trim().length === 0) {
      findings.push({
        code: 'missing_source',
        severity: 'error',
        key: entry.key,
        message: `No source text found for "${entry.key}" (checked ${fallbackOrder.join(', ')})`,
      });
      continue;
    }

    for (const locale of options.locales) {
      if (locale === entry.sourceLocale) continue;
      const value = entry.values[locale];
      if (value === undefined || value.trim().length === 0) {
        findings.push({
          code: 'missing_locale',
          severity: 'warning',
          key: entry.key,
          locale,
          message: `Missing "${locale}" for "${entry.key}" (${leafOf(entry.key)})`,
        });
        continue;
      }

      const { missing, added } = diffTokens(sourceText, value);
      if (missing.length || added.length) {
        const parts: string[] = [];
        if (missing.length) parts.push(`missing ${missing.map((t) => t.value).join(', ')}`);
        if (added.length) parts.push(`unexpected ${added.map((t) => t.value).join(', ')}`);
        findings.push({
          code: 'token_mismatch',
          severity: 'error',
          key: entry.key,
          locale,
          message: `Placeholder/markup mismatch in "${entry.key}" [${locale}]: ${parts.join('; ')}`,
        });
      }

      if (flagCopies && value.trim() === sourceText.trim()) {
        findings.push({
          code: 'suspicious_copy',
          severity: 'warning',
          key: entry.key,
          locale,
          message: `"${locale}" for "${entry.key}" is identical to the source`,
        });
      }
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  return { findings, errorCount, warningCount, ok: errorCount === 0 };
}
