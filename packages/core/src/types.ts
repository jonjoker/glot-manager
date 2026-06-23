/**
 * Core domain types shared across every Glot Manager package.
 *
 * These types are intentionally framework-agnostic and dependency-free so the
 * same shapes flow through the React client, the server handler, the LLM
 * providers, and the storage adapters without translation at the boundaries.
 */

/** A BCP-47-ish locale code, e.g. `"en"`, `"de"`, `"pt-BR"`. */
export type Locale = string;

/**
 * The translated strings for a single key, keyed by locale.
 *
 * A value may be missing while a translation is still in progress, which is why
 * every entry is optional.
 */
export type LocaleValues = Partial<Record<Locale, string>>;

/** Static locale configuration for a Glot Manager deployment. */
export interface LocaleConfig {
  /** Every locale the editor exposes, e.g. `["en", "de", "fr", "it"]`. */
  locales: Locale[];
  /** The default locale used when none is requested. */
  defaultLocale: Locale;
  /**
   * Optional human-readable names per locale (e.g. `{ de: "Deutsch" }`).
   * When omitted, names are derived via `Intl.DisplayNames` with a fallback.
   */
  localeNames?: Partial<Record<Locale, string>>;
}

/**
 * A single stored translation entry — the library's unit of persistence.
 *
 * This is the in-memory representation of one row in whatever store backs the
 * deployment (Postgres, a JSON file, an in-memory map, …).
 */
export interface TranslationEntry {
  /** Dotted key, e.g. `"selfService.research.options.pvCurtailment"`. */
  key: string;
  /** The key minus its last dotted segment. Derived when not provided. */
  namespace: string;
  /** Translated strings keyed by locale. */
  values: LocaleValues;
  /** Which locale holds the human-authored source text. */
  sourceLocale: Locale;
  /** ISO-8601 timestamp of the last update, if the store tracks it. */
  updatedAt?: string;
  /** Identifier of the last editor, if the store tracks it. */
  updatedBy?: string | null;
}

/**
 * One place a translation key is rendered, used to power the "Used in" panel
 * and to give the LLM disambiguating context.
 */
export interface TranslationUsage {
  /** Stable identifier for this usage occurrence. */
  id: string;
  /** Human label, e.g. `"Section title"`, `"Button label"`. */
  label: string;
  /** A route/page label used to build a "jump to" link. */
  route?: string;
  /** A finer-grained location within the route (sidebar sub-item, etc.). */
  subItem?: string;
  /** Free-form notes shown to editors and forwarded to the LLM. */
  notes?: string;
  /** `true` when this usage was observed live in the DOM (vs. statically known). */
  exact?: boolean;
}

/** A translation entry enriched with the places it is used. */
export interface EditableEntry extends TranslationEntry {
  usages: TranslationUsage[];
}

/** Input accepted by {@link TranslationStore.upsert}. */
export interface UpsertEntryInput {
  key: string;
  values: LocaleValues;
  sourceLocale: Locale;
  /** Derived from `key` when omitted. */
  namespace?: string;
  updatedBy?: string | null;
}

/**
 * The persistence contract. Implement this to back Glot Manager with any database.
 *
 * Implementations must be safe to call concurrently and should treat keys as
 * opaque, case-sensitive strings.
 */
export interface TranslationStore {
  /** Return a single entry by key, or `null` if it does not exist. */
  get(key: string): Promise<TranslationEntry | null>;
  /**
   * Return entries. When `keys` is provided, return only those that exist;
   * when omitted, return every entry in the store.
   */
  list(keys?: string[]): Promise<TranslationEntry[]>;
  /**
   * Insert or update an entry, returning the persisted result.
   *
   * Semantics are **merge, not replace**: the supplied `values` are merged onto
   * any existing locales (later wins), so a partial save preserves locales it
   * doesn't mention. There is no upsert path to clear a locale.
   */
  upsert(input: UpsertEntryInput): Promise<TranslationEntry>;
}

/** A glossary / termbase entry the translator must respect. */
export interface GlossaryTerm {
  /** The term as it appears in the source language. */
  term: string;
  /** What the term means, to disambiguate for the model. */
  description?: string;
  /** Approved translations per locale; the model must use these verbatim. */
  translations?: Partial<Record<Locale, string>>;
  /** When `true`, the term must be kept untranslated in every locale. */
  doNotTranslate?: boolean;
  /** Match the term case-sensitively when scanning source text. Default `false`. */
  caseSensitive?: boolean;
}

/**
 * The extensible context injected into every LLM translation call.
 *
 * This is the seam that lets a deployment teach the model about its product,
 * its "company language" (tone/voice/style guide), and its approved
 * terminology. Every field is optional; provide as much or as little as needed.
 */
export interface TranslationContext {
  /** What the product is, e.g. `"energy management software for grid operators"`. */
  domain?: string;
  /**
   * The brand / style guide — the "company language". Free-form prose describing
   * tone, formality, voice, and conventions the translations must follow.
   */
  styleGuide?: string;
  /** Per-locale tone overrides, e.g. `{ de: "Always use the formal 'Sie'." }`. */
  tone?: Partial<Record<Locale, string>>;
  /** Approved terminology the model must honor. */
  glossary?: GlossaryTerm[];
  /** Extra free-form instructions appended to the system prompt. */
  instructions?: string;
  /** Arbitrary structured context merged into the user payload as JSON. */
  metadata?: Record<string, unknown>;
}

/**
 * A fully-resolved translation request handed to a {@link Translator}.
 *
 * The source text in `sourceLocale` is translated into each `targetLocales`
 * entry, honoring `context` (domain, style guide, glossary, tone) and `usages`.
 */
export interface TranslationJob {
  /** The key being translated, included purely as context for the model. */
  key?: string;
  /** The locale of `sourceText`. */
  sourceLocale: Locale;
  /** The human-authored source string. */
  sourceText: string;
  /** Locales to translate into (never includes `sourceLocale`). */
  targetLocales: Locale[];
  /** Where the string appears, to disambiguate meaning. */
  usages?: TranslationUsage[];
  /** Resolved domain/style/glossary/tone context. */
  context?: TranslationContext;
  /** Display names for locales, e.g. `{ de: "Deutsch" }`. */
  localeNames?: Partial<Record<Locale, string>>;
}

/** Per-call options for a {@link Translator}. */
export interface TranslateOptions {
  /** Abort the underlying request. */
  signal?: AbortSignal;
}

/**
 * A pluggable machine-translation backend.
 *
 * Built-in implementations live in `@glot-manager/openai` and `@glot-manager/anthropic`, but any
 * object satisfying this interface works — including a deterministic fake for
 * tests or an on-prem model.
 */
export interface Translator {
  /** Stable identifier, e.g. `"openai"` or `"anthropic"`. Used in logs. */
  readonly id: string;
  /**
   * Translate `job.sourceText` into every `job.targetLocales` entry.
   *
   * Implementations should return a map that contains a string for each
   * requested target locale. The source locale is left untouched by callers.
   */
  translate(job: TranslationJob, options?: TranslateOptions): Promise<LocaleValues>;
}
