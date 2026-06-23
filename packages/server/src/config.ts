import type {
  BuildPromptOptions,
  ContextProvider,
  KeyAlias,
  LocaleConfig,
  TranslationContext,
  TranslationStore,
  Translator,
  UsageProvider,
  UsageRegistry,
} from '@glot-manager/core';
import { normalizeLocaleConfig, registryUsageProvider } from '@glot-manager/core';
import type { Authorizer } from './auth.ts';
import { type Logger, createDefaultLogger } from './logger.ts';

/** Result of a rate-limit check. */
export interface RateLimitResult {
  ok: boolean;
  /** Seconds the client should wait before retrying (sets `Retry-After`). */
  retryAfterSeconds?: number;
}

/**
 * A pluggable rate limiter. Return `{ ok: false, retryAfterSeconds }` to reject
 * with `429`. Keep an eye on the auto-translate route, which proxies the LLM.
 */
export type RateLimiter = (
  request: Request,
  context: { route: string; userId?: string | null },
) => RateLimitResult | Promise<RateLimitResult>;

/** Fires after a successful save so you can invalidate caches / revalidate tags. */
export type OnChange = (changedKeys: string[]) => void | Promise<void>;

export interface GlotServerConfig {
  /** Where translations are persisted. Required. */
  store: TranslationStore;
  /** The locales the editor exposes. Required. */
  locales: LocaleConfig;
  /**
   * Authorization check, run first on every request. Return a truthy value (or
   * a principal object) to allow, a falsy value to reject with `403`. The
   * library ships no auth scheme — wire in your own session/JWT/Clerk/etc.
   * **The client edit-mode flag is UX only; this is the real gate.**
   */
  authorize: Authorizer;

  /**
   * The LLM backend for "Auto translate". Optional — when omitted, the
   * auto-translate endpoint returns `501` and the client hides the button.
   */
  translator?: Translator;
  /** Static context (domain, style guide, glossary, tone) for the translator. */
  context?: TranslationContext;
  /** Dynamic, per-request context (e.g. a per-tenant glossary from the DB). */
  contextProvider?: ContextProvider;
  /** Extra prompt options forwarded to the prompt builder. */
  promptOptions?: BuildPromptOptions;

  /**
   * Keys an admin may edit, by prefix (e.g. `["app.", "marketing."]`). An upsert
   * to a key outside this allowlist is rejected with `400`. Empty/omitted allows
   * any structurally-valid key — set it in production.
   */
  editableKeyPrefixes?: string[];
  /** Prefix aliases (e.g. `grid` ↔ `gridConnection`). */
  keyAliases?: KeyAlias[];

  /** Where the key is used, for the "Used in" panel and LLM context. */
  usages?: UsageProvider | UsageRegistry;

  /** Mount path the handler is served under. Default `/api/glot`. */
  basePath?: string;

  /** Allowed `Origin`s for mutating requests. Same-origin is always allowed. */
  allowedOrigins?: string[];
  /** Disable the built-in CSRF (Sec-Fetch-Site / Origin) checks. Default `false`. */
  disableCsrfProtection?: boolean;

  /** Invoked after a successful save (cache invalidation / revalidation). */
  onChange?: OnChange;
  /** Optional rate limiter. */
  rateLimit?: RateLimiter;
  /** Structured logger. Defaults to a console logger that redacts secrets. */
  logger?: Logger;
}

export interface ResolvedConfig {
  store: TranslationStore;
  locales: LocaleConfig;
  authorize: Authorizer;
  translator?: Translator;
  context?: TranslationContext;
  contextProvider?: ContextProvider;
  promptOptions?: BuildPromptOptions;
  editableKeyPrefixes: string[];
  keyAliases: KeyAlias[];
  usageProvider: UsageProvider;
  basePath: string;
  allowedOrigins: string[];
  disableCsrfProtection: boolean;
  onChange?: OnChange;
  rateLimit?: RateLimiter;
  logger: Logger;
}

function normalizeBasePath(basePath: string | undefined): string {
  const value = basePath ?? '/api/glot';
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
}

function toUsageProvider(usages: GlotServerConfig['usages']): UsageProvider {
  if (!usages) return () => [];
  if (typeof usages === 'function') return usages;
  return registryUsageProvider(usages);
}

/** Validate and fill in defaults for a {@link GlotServerConfig}. */
export function resolveConfig(config: GlotServerConfig): ResolvedConfig {
  return {
    store: config.store,
    locales: normalizeLocaleConfig(config.locales),
    authorize: config.authorize,
    ...(config.translator ? { translator: config.translator } : {}),
    ...(config.context ? { context: config.context } : {}),
    ...(config.contextProvider ? { contextProvider: config.contextProvider } : {}),
    ...(config.promptOptions ? { promptOptions: config.promptOptions } : {}),
    editableKeyPrefixes: config.editableKeyPrefixes ?? [],
    keyAliases: config.keyAliases ?? [],
    usageProvider: toUsageProvider(config.usages),
    basePath: normalizeBasePath(config.basePath),
    allowedOrigins: config.allowedOrigins ?? [],
    disableCsrfProtection: config.disableCsrfProtection ?? false,
    ...(config.onChange ? { onChange: config.onChange } : {}),
    ...(config.rateLimit ? { rateLimit: config.rateLimit } : {}),
    logger: config.logger ?? createDefaultLogger(),
  };
}
