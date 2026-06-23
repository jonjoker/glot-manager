/**
 * `@glot-manager/server` — the framework-agnostic Web-Fetch request handler.
 *
 * Build it once with {@link createGlotHandler} and mount it under a catch-all
 * route. Adapters for Next.js, Node, and Express live in subpath exports
 * (`@glot-manager/server/next`, `/node`, `/express`).
 */

export { createGlotHandler, type GlotHandler } from './handler.ts';
export {
  resolveConfig,
  type GlotServerConfig,
  type ResolvedConfig,
  type RateLimiter,
  type RateLimitResult,
  type OnChange,
} from './config.ts';
export { runAuthorize, type Authorizer, type AuthResult, type GlotPrincipal } from './auth.ts';
export {
  createDefaultLogger,
  sanitizeMeta,
  sanitizeLogValue,
  silentLogger,
  type Logger,
} from './logger.ts';
export { assertSameOrigin } from './security.ts';

// Re-export the operation functions so they can be composed in custom servers.
export {
  autoTranslate,
  getConfig,
  getEntry,
  getUsages,
  listEntries,
  saveEntry,
} from './operations.ts';
