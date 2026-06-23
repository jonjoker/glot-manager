import type { Locale, LocaleValues, TranslationJob, Translator } from './types.ts';
import { TranslatorError } from './errors.ts';

/**
 * Best-effort extraction of a JSON object from raw model output.
 *
 * Tolerates models that wrap JSON in ```fences``` or add a stray sentence, by
 * slicing from the first `{` to the matching last `}` when a direct parse fails.
 */
export function parseJsonObject(raw: string): Record<string, unknown> {
  const attempt = (text: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(text) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = attempt(raw.trim());
  if (direct) return direct;

  const fenced = raw.replace(/```(?:json)?/gi, '').trim();
  const fencedParsed = attempt(fenced);
  if (fencedParsed) return fencedParsed;

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const sliced = attempt(raw.slice(start, end + 1));
    if (sliced) return sliced;
  }

  throw new TranslatorError('Translator returned a response that was not valid JSON');
}

/**
 * Validate a parsed model response against the expected locales and coerce it
 * to {@link LocaleValues}, throwing {@link TranslatorError} if any target locale
 * is missing or non-string.
 */
export function coerceTranslationResult(
  parsed: Record<string, unknown>,
  expectedKeys: readonly Locale[],
): LocaleValues {
  const result: LocaleValues = {};
  const missing: Locale[] = [];

  for (const locale of expectedKeys) {
    const value = parsed[locale];
    if (typeof value === 'string') {
      result[locale] = value;
    } else {
      missing.push(locale);
    }
  }

  if (missing.length > 0) {
    throw new TranslatorError(
      `Translator response is missing string values for: ${missing.join(', ')}`,
    );
  }

  return result;
}

/** Parse + validate raw model output in one step. */
export function parseTranslationResponse(
  raw: string,
  expectedKeys: readonly Locale[],
): LocaleValues {
  return coerceTranslationResult(parseJsonObject(raw), expectedKeys);
}

export interface EchoTranslatorOptions {
  /** Prefix added to each translated value. Default `"[{locale}] "`. */
  decorate?: (value: string, locale: Locale) => string;
  /** Artificial latency in milliseconds, to mimic a network call in demos. */
  latencyMs?: number;
  /** Identifier reported by the translator. Default `"echo"`. */
  id?: string;
}

/**
 * A deterministic, offline {@link Translator} for local development, demos, and
 * tests. It does not call any network service; it echoes the source text with a
 * per-locale prefix, preserving all placeholders so validation passes.
 *
 * Never use this in production — it does not actually translate.
 */
export function createEchoTranslator(options: EchoTranslatorOptions = {}): Translator {
  const decorate = options.decorate ?? ((value, locale) => `[${locale}] ${value}`);
  const id = options.id ?? 'echo';
  return {
    id,
    async translate(job: TranslationJob): Promise<LocaleValues> {
      if (options.latencyMs && options.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      }
      const result: LocaleValues = {};
      for (const locale of job.targetLocales) {
        result[locale] = decorate(job.sourceText, locale);
      }
      return result;
    },
  };
}
