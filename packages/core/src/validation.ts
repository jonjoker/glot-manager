import type { Locale, LocaleValues, TranslationJob } from './types.ts';

/**
 * The kinds of "tokens" that must be preserved verbatim across a translation.
 * A mismatch in any of these between source and target almost always indicates
 * a broken string (a dropped `{count}`, a mangled `<b>` tag, a lost `%s`, …).
 */
export type TokenKind = 'icuArg' | 'placeholder' | 'printf' | 'tag' | 'newline';

export interface Token {
  kind: TokenKind;
  /** The normalized token value used for comparison (e.g. the arg name, tag name). */
  value: string;
}

const ICU_ARG = /\{\s*([A-Za-z0-9_]+)\s*,\s*(plural|select|selectordinal|number|date|time)\b/g;
const SIMPLE_PLACEHOLDER = /\{\s*([A-Za-z0-9_]+)\s*\}/g;
// printf-style: %s, %d, %1$s, %02d, %f. The `%%` alternation matches the escaped
// literal percent first so it is consumed (and skipped) rather than mis-read as a
// conversion like `% o` in "50%% off".
const PRINTF = /%%|%(?:\d+\$)?[-+ 0#]?\d*(?:\.\d+)?[sdifeEgGxXoc]/g;
const HTML_TAG = /<\/?\s*([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g;

/**
 * Extract the multiset of preservation-critical tokens from a string.
 *
 * The result is order-independent and deduped-with-counts via {@link tokenKey},
 * so it can be compared structurally between a source and a candidate
 * translation.
 */
export function extractTokens(text: string): Token[] {
  const tokens: Token[] = [];

  const icuArgNames = new Set<string>();
  for (const match of text.matchAll(ICU_ARG)) {
    if (match[1]) {
      icuArgNames.add(match[1]);
      tokens.push({ kind: 'icuArg', value: match[1] });
    }
  }
  for (const match of text.matchAll(SIMPLE_PLACEHOLDER)) {
    // Skip inner references to an arg already captured as an ICU construct
    // (`{count, plural, other {{count} …}}` — the inner `{count}` is not a
    // separate placeholder), otherwise plural/select branch differences across
    // languages would look like a token mismatch.
    if (match[1] && !icuArgNames.has(match[1])) {
      tokens.push({ kind: 'placeholder', value: match[1] });
    }
  }
  for (const match of text.matchAll(PRINTF)) {
    if (match[0] === '%%') continue; // escaped literal percent, not a token
    tokens.push({ kind: 'printf', value: match[0] });
  }
  for (const match of text.matchAll(HTML_TAG)) {
    if (match[1]) tokens.push({ kind: 'tag', value: match[1].toLowerCase() });
  }
  const newlines = text.match(/\n/g);
  if (newlines) {
    for (let i = 0; i < newlines.length; i++) tokens.push({ kind: 'newline', value: '\\n' });
  }

  return tokens;
}

function tokenKey(token: Token): string {
  return `${token.kind}:${token.value}`;
}

function toCounts(tokens: Token[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    const key = tokenKey(token);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface TokenDiff {
  /** Tokens present in the source but missing (or under-represented) in the target. */
  missing: Token[];
  /** Tokens present in the target but absent (or over-represented) in the source. */
  added: Token[];
}

/** Structurally compare the tokens of two strings. */
export function diffTokens(source: string, target: string): TokenDiff {
  const sourceCounts = toCounts(extractTokens(source));
  const targetCounts = toCounts(extractTokens(target));
  const missing: Token[] = [];
  const added: Token[] = [];

  const decode = (key: string): Token => {
    const idx = key.indexOf(':');
    return { kind: key.slice(0, idx) as TokenKind, value: key.slice(idx + 1) };
  };

  for (const [key, count] of sourceCounts) {
    const delta = count - (targetCounts.get(key) ?? 0);
    for (let i = 0; i < delta; i++) missing.push(decode(key));
  }
  for (const [key, count] of targetCounts) {
    const delta = count - (sourceCounts.get(key) ?? 0);
    for (let i = 0; i < delta; i++) added.push(decode(key));
  }

  return { missing, added };
}

/** Whether two strings carry exactly the same preservation-critical tokens. */
export function tokensMatch(source: string, target: string): boolean {
  const { missing, added } = diffTokens(source, target);
  return missing.length === 0 && added.length === 0;
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: 'missing_locale' | 'empty_value' | 'token_mismatch' | 'suspicious_copy';
  locale: Locale;
  message: string;
}

export interface ValidateValuesOptions {
  /** Treat a target value identical to the source as a warning. Default `true`. */
  flagSuspiciousCopies?: boolean;
}

/**
 * Validate a set of translated `values` for a job: every target locale must be
 * present and non-empty, and each must preserve the source's tokens.
 *
 * This is used both as a guardrail after an LLM call and by the audit tooling.
 */
export function validateTranslationValues(
  job: Pick<TranslationJob, 'sourceLocale' | 'sourceText' | 'targetLocales'>,
  values: LocaleValues,
  options: ValidateValuesOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const flagCopies = options.flagSuspiciousCopies ?? true;

  for (const locale of job.targetLocales) {
    const value = values[locale];
    if (value === undefined) {
      issues.push({
        severity: 'error',
        code: 'missing_locale',
        locale,
        message: `Missing translation for "${locale}"`,
      });
      continue;
    }
    if (value.trim().length === 0) {
      issues.push({
        severity: 'error',
        code: 'empty_value',
        locale,
        message: `Empty translation for "${locale}"`,
      });
      continue;
    }

    const { missing, added } = diffTokens(job.sourceText, value);
    if (missing.length > 0 || added.length > 0) {
      const parts: string[] = [];
      if (missing.length) parts.push(`missing ${missing.map((t) => t.value).join(', ')}`);
      if (added.length) parts.push(`unexpected ${added.map((t) => t.value).join(', ')}`);
      issues.push({
        severity: 'error',
        code: 'token_mismatch',
        locale,
        message: `Placeholder/markup mismatch in "${locale}": ${parts.join('; ')}`,
      });
    }

    if (flagCopies && value.trim() === job.sourceText.trim() && job.sourceText.trim().length > 0) {
      issues.push({
        severity: 'warning',
        code: 'suspicious_copy',
        locale,
        message: `Translation for "${locale}" is identical to the source text`,
      });
    }
  }

  return issues;
}

/** Convenience: only the blocking (error-severity) issues from a validation run. */
export function errorsOnly(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}
