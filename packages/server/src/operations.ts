import {
  applyKeyAliases,
  BadRequestError,
  buildLocaleNames,
  GlotError,
  isEditableKey,
  isValidKey,
  namespaceOf,
  normalizeValues,
  resolveContext,
  targetLocalesFor,
  validateTranslationValues,
  type AutoTranslateRequest,
  type AutoTranslateResponse,
  type ConfigResponse,
  type EditableEntry,
  type GetEntryResponse,
  type ListEntriesResponse,
  type Locale,
  type LocaleValues,
  type SaveEntryRequest,
  type SaveEntryResponse,
  type TranslationJob,
  type UsageResponse,
} from '@glot-manager/core';
import type { GlotPrincipal } from './auth.ts';
import type { ResolvedConfig } from './config.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonicalize and authorize a key for editing, throwing `400` if not editable. */
function assertEditableKey(key: string, config: ResolvedConfig): string {
  const canonical = applyKeyAliases(key, config.keyAliases);
  if (!isValidKey(canonical)) {
    throw new BadRequestError('Malformed translation key');
  }
  if (!isEditableKey(canonical, config.editableKeyPrefixes)) {
    throw new BadRequestError(
      `Key "${canonical}" is not editable (allowed prefixes: ${
        config.editableKeyPrefixes.join(', ') || '∅'
      })`,
    );
  }
  return canonical;
}

function validateLocale(locale: unknown, config: ResolvedConfig): Locale {
  if (typeof locale !== 'string' || !config.locales.locales.includes(locale)) {
    throw new BadRequestError(`Unknown locale "${String(locale)}"`);
  }
  return locale;
}

function parseValues(raw: unknown, config: ResolvedConfig): LocaleValues {
  if (!isRecord(raw)) throw new BadRequestError('`values` must be an object');
  for (const [locale, value] of Object.entries(raw)) {
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new BadRequestError(`Value for "${locale}" must be a string`);
    }
  }
  return normalizeValues(raw, config.locales.locales);
}

async function withUsages(
  config: ResolvedConfig,
  key: string,
  entry: Omit<EditableEntry, 'usages'>,
): Promise<EditableEntry> {
  const usages = await config.usageProvider(key);
  return { ...entry, usages };
}

export function getConfig(config: ResolvedConfig): ConfigResponse {
  return {
    locales: config.locales.locales,
    defaultLocale: config.locales.defaultLocale,
    localeNames: buildLocaleNames(config.locales),
    autoTranslate: Boolean(config.translator),
  };
}

export async function listEntries(config: ResolvedConfig): Promise<ListEntriesResponse> {
  const all = await config.store.list();
  // Apply the same allowlist as the per-key routes, so `/entries` can't be used
  // to read keys outside the editable scope.
  const entries =
    config.editableKeyPrefixes.length === 0
      ? all
      : all.filter((entry) =>
          isEditableKey(applyKeyAliases(entry.key, config.keyAliases), config.editableKeyPrefixes),
        );
  const enriched = await Promise.all(
    entries.map((entry) => withUsages(config, entry.key, { ...entry })),
  );
  return { entries: enriched };
}

export async function getEntry(config: ResolvedConfig, rawKey: string): Promise<GetEntryResponse> {
  const key = assertEditableKey(rawKey, config);
  const existing = await config.store.get(key);
  const base: Omit<EditableEntry, 'usages'> = existing ?? {
    key,
    namespace: namespaceOf(key),
    values: {},
    sourceLocale: config.locales.defaultLocale,
  };
  return { entry: await withUsages(config, key, base) };
}

export async function saveEntry(
  config: ResolvedConfig,
  rawKey: string,
  body: unknown,
  principal: GlotPrincipal,
): Promise<SaveEntryResponse> {
  const key = assertEditableKey(rawKey, config);
  if (!isRecord(body)) throw new BadRequestError('Request body must be a JSON object');

  const request: SaveEntryRequest = {
    sourceLocale: validateLocale(body.sourceLocale, config),
    values: parseValues(body.values, config),
  };

  const saved = await config.store.upsert({
    key,
    namespace: namespaceOf(key),
    values: request.values,
    sourceLocale: request.sourceLocale,
    updatedBy: principal.userId ?? null,
  });

  await config.onChange?.([key]);
  return { entry: await withUsages(config, key, { ...saved }) };
}

export async function autoTranslate(
  config: ResolvedConfig,
  rawKey: string,
  body: unknown,
): Promise<AutoTranslateResponse> {
  if (!config.translator) {
    throw new GlotError('Auto-translate is not configured on this server', {
      code: 'config_error',
      status: 501,
    });
  }
  const key = assertEditableKey(rawKey, config);
  if (!isRecord(body)) throw new BadRequestError('Request body must be a JSON object');

  const request: AutoTranslateRequest = {
    sourceLocale: validateLocale(body.sourceLocale, config),
    values: parseValues(body.values, config),
    ...(Array.isArray(body.targetLocales)
      ? { targetLocales: body.targetLocales.filter((l): l is string => typeof l === 'string') }
      : {}),
  };

  const sourceText = request.values[request.sourceLocale]?.trim();
  if (!sourceText) {
    throw new BadRequestError(`Source text for "${request.sourceLocale}" is empty`);
  }

  const targetLocales = (
    request.targetLocales ?? targetLocalesFor(request.sourceLocale, config.locales.locales)
  ).filter((locale) => config.locales.locales.includes(locale) && locale !== request.sourceLocale);
  if (targetLocales.length === 0) {
    return { values: request.values };
  }

  const usages = await config.usageProvider(key);
  const job: TranslationJob = {
    key,
    sourceLocale: request.sourceLocale,
    sourceText,
    targetLocales,
    usages,
    localeNames: buildLocaleNames(config.locales),
  };
  job.context = await resolveContext(job, config.context, config.contextProvider);

  const translated = await config.translator.translate(job);
  const values: LocaleValues = { ...request.values, ...translated };
  const issues = validateTranslationValues(job, translated);

  return issues.length > 0 ? { values, issues } : { values };
}

export async function getUsages(config: ResolvedConfig, rawKey: string): Promise<UsageResponse> {
  const key = assertEditableKey(rawKey, config);
  return { usages: await config.usageProvider(key) };
}
