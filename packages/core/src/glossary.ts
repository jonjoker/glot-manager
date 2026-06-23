import type { GlossaryTerm, Locale } from './types.ts';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether a glossary `term` appears in `text` as a whole word. */
export function termAppearsIn(term: GlossaryTerm, text: string): boolean {
  if (term.term.length === 0) return false;
  const flags = term.caseSensitive ? 'u' : 'iu';
  // `\b` is unreliable for non-ASCII; fall back to a loose boundary check.
  const isWordy = /^[\w-]+$/u.test(term.term);
  const pattern = isWordy
    ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term.term)}(?![\\p{L}\\p{N}])`, flags)
    : new RegExp(escapeRegExp(term.term), flags);
  return pattern.test(text);
}

/**
 * Return only the glossary terms relevant to a given source text — i.e. those
 * that actually appear in it — so the prompt stays focused and small.
 */
export function selectRelevantGlossary(
  text: string,
  glossary: readonly GlossaryTerm[] | undefined,
): GlossaryTerm[] {
  if (!glossary || glossary.length === 0) return [];
  return glossary.filter((term) => termAppearsIn(term, text));
}

/**
 * Render a glossary subset as a compact, model-friendly instruction block.
 * Returns an empty string when there is nothing to say.
 */
export function renderGlossary(
  terms: readonly GlossaryTerm[],
  targetLocales: readonly Locale[],
): string {
  if (terms.length === 0) return '';

  const lines: string[] = ['Approved terminology — follow these exactly:'];
  for (const term of terms) {
    if (term.doNotTranslate) {
      lines.push(`- "${term.term}": keep untranslated in all languages.`);
      continue;
    }
    const renderings = targetLocales
      .map((locale) => {
        const translation = term.translations?.[locale];
        return translation ? `${locale}="${translation}"` : null;
      })
      .filter((entry): entry is string => entry !== null);

    let line = `- "${term.term}"`;
    if (term.description) line += ` (${term.description})`;
    if (renderings.length > 0) line += `: ${renderings.join(', ')}`;
    lines.push(line);
  }
  return lines.join('\n');
}

/** Merge two glossaries, de-duplicating by term (later entries win). */
export function mergeGlossaries(
  base: readonly GlossaryTerm[] | undefined,
  override: readonly GlossaryTerm[] | undefined,
): GlossaryTerm[] {
  // Case-sensitive terms are kept distinct from case-insensitive ones, so a
  // deliberate acronym (`IT`, caseSensitive) isn't collapsed into `it`.
  const dedupeKey = (term: GlossaryTerm): string =>
    term.caseSensitive ? `cs:${term.term}` : `ci:${term.term.toLowerCase()}`;
  const byTerm = new Map<string, GlossaryTerm>();
  for (const term of base ?? []) byTerm.set(dedupeKey(term), term);
  for (const term of override ?? []) byTerm.set(dedupeKey(term), term);
  return [...byTerm.values()];
}
