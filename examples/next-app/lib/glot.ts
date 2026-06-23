import { MemoryStore, type LocaleConfig, type Locale, type TranslationContext } from '@glot-manager/core';

/** The locales this demo exposes. */
export const locales: LocaleConfig = {
  locales: ['en', 'de', 'fr', 'it'],
  defaultLocale: 'en',
};

/** Seed copy for the demo (normally this table lives in your database). */
const SEED = {
  'home.title': {
    values: {
      en: 'Translate your app in context',
      de: 'Übersetze deine App im Kontext',
      fr: 'Traduisez votre application en contexte',
      it: 'Traduci la tua app nel contesto',
    },
  },
  'home.subtitle': {
    values: {
      en: 'Flip on edit mode, click any highlighted label, and edit every language right here.',
      de: 'Schalte den Bearbeitungsmodus ein, klicke auf eine markierte Beschriftung und bearbeite jede Sprache direkt hier.',
    },
  },
  'cta.primary': { values: { en: 'Get started' } },
  'cta.secondary': { values: { en: 'Read the docs' } },
  'nav.pricing': { values: { en: 'Pricing' } },
  'footer.tagline': { values: { en: 'Built with Glot Manager — in-context, AI-native translation.' } },
};

/**
 * A process-wide in-memory store, cached on `globalThis` so it survives Next's
 * dev-mode hot reloads. Swap `MemoryStore` for `@glot-manager/postgres` in production.
 */
const globalForGlot = globalThis as unknown as { __glotStore?: MemoryStore };
export const store: MemoryStore =
  globalForGlot.__glotStore ?? (globalForGlot.__glotStore = new MemoryStore(SEED));

/**
 * The extensible context handed to the LLM on every auto-translate: product
 * domain, brand voice, and an approved glossary.
 */
export const translationContext: TranslationContext = {
  domain: 'a developer tool for editing website translations directly on the live page',
  styleGuide: 'Friendly, concise, and professional. Speak directly to developers. Avoid jargon.',
  glossary: [
    { term: 'in-context', description: 'editing translations on the live page, where they appear' },
    { term: 'Glot Manager', doNotTranslate: true },
  ],
};

/** Build a flat `{ key: text }` map for a locale from the current store state. */
export async function messagesFor(locale: Locale): Promise<Record<string, string>> {
  const entries = await store.list();
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const value = entry.values[locale];
    if (typeof value === 'string') out[entry.key] = value;
  }
  return out;
}
