import type { Locale, TranslationJob } from './types.ts';
import { localeDisplayName } from './locale.ts';
import { renderGlossary, selectRelevantGlossary } from './glossary.ts';

/**
 * A provider-agnostic prompt. LLM providers (`@glot-manager/openai`, `@glot-manager/anthropic`)
 * translate this into their own request shape.
 */
export interface TranslationPrompt {
  system: string;
  user: string;
  /** The exact JSON object shape the model is told to return. */
  expectedKeys: Locale[];
}

export interface BuildPromptOptions {
  /**
   * Replace the default system preamble entirely. The instruction to return a
   * JSON object with the target locale keys is always appended afterwards, so a
   * custom preamble cannot accidentally break parsing.
   */
  system?: string;
  /** Extra instructions appended to the (default or custom) system preamble. */
  extraInstructions?: string;
}

/**
 * A fully custom prompt builder. Provide one to a translator to take complete
 * control of how `context`, glossary, and usages are rendered.
 */
export type PromptBuilder = (
  job: TranslationJob,
  options?: BuildPromptOptions,
) => TranslationPrompt;

const DEFAULT_SYSTEM = [
  'You are a professional software localization engine.',
  'You translate short user-interface strings for a web application.',
  'Translate faithfully and idiomatically for native speakers, matching the register of product UI copy.',
  '',
  'Hard rules — never violate these:',
  '- Preserve every placeholder exactly: ICU arguments like {count}, ICU plural/select blocks, printf tokens like %s and %1$d, and HTML tags like <b>…</b>. Do not translate, reorder the syntax of, or drop them.',
  '- Preserve leading/trailing whitespace, line breaks, and surrounding punctuation.',
  '- Match the capitalization style of the source (e.g. sentence case vs. Title Case) unless a target language requires otherwise.',
  '- Do not add explanations, quotes, or markdown. Translate only the text.',
].join('\n');

function renderLocaleName(locale: Locale, job: TranslationJob): string {
  return localeDisplayName(locale, job.localeNames);
}

/**
 * The default {@link PromptBuilder}. It renders the source string, the relevant
 * glossary subset, the domain/style-guide context, per-locale tone, and the
 * places the string is used, then asks for a strict JSON object keyed by the
 * target locales.
 *
 * Pass your own builder (or override pieces via {@link BuildPromptOptions}) to
 * extend this — the seam the spec calls out for "context, company language and
 * glossary information".
 */
export function buildTranslationPrompt(
  job: TranslationJob,
  options: BuildPromptOptions = {},
): TranslationPrompt {
  const context = job.context ?? {};
  const targetLocales = job.targetLocales;

  const systemParts: string[] = [options.system ?? DEFAULT_SYSTEM];

  if (context.domain) {
    systemParts.push('', `Product domain: ${context.domain}`);
  }
  if (context.styleGuide) {
    systemParts.push(
      '',
      `Brand voice and style guide (the "company language"):`,
      context.styleGuide,
    );
  }
  if (context.instructions) {
    systemParts.push('', context.instructions);
  }
  if (options.extraInstructions) {
    systemParts.push('', options.extraInstructions);
  }

  const userParts: string[] = [];
  if (job.key) userParts.push(`Key: ${job.key}`);
  userParts.push(
    `Source language: ${renderLocaleName(job.sourceLocale, job)} (${job.sourceLocale})`,
  );
  userParts.push('Source text:', JSON.stringify(job.sourceText));

  const glossary = renderGlossary(
    selectRelevantGlossary(job.sourceText, context.glossary),
    targetLocales,
  );
  if (glossary) userParts.push('', glossary);

  if (job.usages && job.usages.length > 0) {
    const usageLines = job.usages
      .slice(0, 8)
      .map((usage) => {
        const where = [usage.label, usage.route, usage.subItem].filter(Boolean).join(' › ');
        return usage.notes ? `- ${where} — ${usage.notes}` : `- ${where}`;
      })
      .join('\n');
    userParts.push('', 'This string appears in:', usageLines);
  }

  const toneLines = targetLocales
    .map((locale) => {
      const tone = context.tone?.[locale];
      return tone ? `- ${locale}: ${tone}` : null;
    })
    .filter((line): line is string => line !== null);
  if (toneLines.length > 0) {
    userParts.push('', 'Per-language tone:', toneLines.join('\n'));
  }

  if (context.metadata && Object.keys(context.metadata).length > 0) {
    userParts.push('', `Additional context (JSON): ${JSON.stringify(context.metadata)}`);
  }

  const targetList = targetLocales
    .map((locale) => `"${locale}" (${renderLocaleName(locale, job)})`)
    .join(', ');
  userParts.push(
    '',
    `Translate the source text into: ${targetList}.`,
    `Return ONLY a JSON object whose keys are exactly ${JSON.stringify(
      targetLocales,
    )} and whose values are the translated strings. No other keys, no commentary.`,
  );

  return {
    system: systemParts.join('\n'),
    user: userParts.join('\n'),
    expectedKeys: [...targetLocales],
  };
}
