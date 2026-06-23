import type { Locale, LocaleConfig } from './types.ts';

/** A small fallback table for the common locales, used when `Intl` is unhelpful. */
const FALLBACK_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  es: 'Español',
  pt: 'Português',
  nl: 'Nederlands',
  pl: 'Polski',
  cs: 'Čeština',
  da: 'Dansk',
  sv: 'Svenska',
  no: 'Norsk',
  fi: 'Suomi',
  ja: '日本語',
  zh: '中文',
};

/**
 * Resolve a human-readable name for a locale.
 *
 * Resolution order: explicit `overrides` → `Intl.DisplayNames` (autonym, i.e.
 * the name as written in that language) → a small fallback table → the code.
 */
export function localeDisplayName(
  locale: Locale,
  overrides?: Partial<Record<Locale, string>>,
): string {
  const override = overrides?.[locale];
  if (override) return override;

  const base = locale.split('-')[0] ?? locale;
  try {
    // Autonym: render the language name in its own language, keyed off the base
    // language subtag so a region (`-ZZ`) can't pollute the result.
    const dn = new Intl.DisplayNames([base], { type: 'language', fallback: 'none' });
    const name = dn.of(base);
    if (name && name.toLowerCase() !== base.toLowerCase() && !/unknown/i.test(name)) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch {
    // `Intl.DisplayNames` may be unavailable or throw on odd input; fall through.
  }

  return FALLBACK_NAMES[base] ?? FALLBACK_NAMES[locale] ?? locale;
}

/** Build a `{ locale: name }` map for every locale in a config. */
export function buildLocaleNames(config: LocaleConfig): Record<Locale, string> {
  const out: Record<Locale, string> = {};
  for (const locale of config.locales) {
    out[locale] = localeDisplayName(locale, config.localeNames);
  }
  return out;
}

/** Whether `locale` is one of the configured locales. */
export function isSupportedLocale(locale: string, config: LocaleConfig): locale is Locale {
  return config.locales.includes(locale);
}

/**
 * Validate and normalize a {@link LocaleConfig}, throwing on obvious mistakes.
 *
 * Guarantees a de-duplicated, non-empty `locales` array that includes
 * `defaultLocale`.
 */
export function normalizeLocaleConfig(config: LocaleConfig): LocaleConfig {
  const locales = [...new Set(config.locales)];
  if (locales.length === 0) {
    throw new RangeError('LocaleConfig.locales must contain at least one locale');
  }
  if (!locales.includes(config.defaultLocale)) {
    throw new RangeError(
      `LocaleConfig.defaultLocale "${config.defaultLocale}" is not present in locales [${locales.join(
        ', ',
      )}]`,
    );
  }
  return {
    locales,
    defaultLocale: config.defaultLocale,
    ...(config.localeNames ? { localeNames: config.localeNames } : {}),
  };
}
