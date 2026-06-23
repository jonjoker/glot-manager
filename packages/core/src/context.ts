import type { TranslationContext, TranslationJob } from './types.ts';
import { mergeGlossaries } from './glossary.ts';

/**
 * A hook that produces additional context for a translation job at request time.
 *
 * This is the dynamic counterpart to a static {@link TranslationContext}: use it
 * to load a per-tenant glossary from the database, vary the style guide per
 * brand, or inject usage-derived hints. The result is merged on top of any
 * static context (see {@link mergeContext}).
 */
export type ContextProvider = (
  job: TranslationJob,
) => TranslationContext | undefined | Promise<TranslationContext | undefined>;

/**
 * Merge two contexts. Scalar fields from `override` win; `glossary` arrays are
 * concatenated and de-duplicated; `tone` and `metadata` are shallow-merged.
 */
export function mergeContext(
  base: TranslationContext | undefined,
  override: TranslationContext | undefined,
): TranslationContext {
  if (!base) return override ?? {};
  if (!override) return base;

  const merged: TranslationContext = { ...base, ...override };

  const glossary = mergeGlossaries(base.glossary, override.glossary);
  if (glossary.length > 0) merged.glossary = glossary;

  if (base.tone || override.tone) {
    merged.tone = { ...base.tone, ...override.tone };
  }
  if (base.metadata || override.metadata) {
    merged.metadata = { ...base.metadata, ...override.metadata };
  }

  return merged;
}

/**
 * Resolve the final context for a job by merging static context with the output
 * of an optional dynamic {@link ContextProvider}.
 */
export async function resolveContext(
  job: TranslationJob,
  staticContext: TranslationContext | undefined,
  provider: ContextProvider | undefined,
): Promise<TranslationContext> {
  const base = mergeContext(staticContext, job.context);
  if (!provider) return base;
  const dynamic = await provider(job);
  return mergeContext(base, dynamic);
}
