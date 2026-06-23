import { GlotError, isGlotError, type ErrorResponse } from '@glot-manager/core';
import type { Logger } from './logger.ts';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

/** Client-safe messages for 5xx errors (the raw message stays in the server log). */
const GENERIC_5XX_MESSAGE: Record<string, string> = {
  translator_failed: 'The translation provider failed',
  config_error: 'Server configuration error',
  internal_error: 'Internal server error',
};

/** Build a JSON `Response` with no-store caching (this is admin-only API data). */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function notFound(message = 'Not found'): Response {
  const body: ErrorResponse = { error: { code: 'not_found', message } };
  return new Response(JSON.stringify(body), { status: 404, headers: JSON_HEADERS });
}

export function methodNotAllowed(allow: string[]): Response {
  const body: ErrorResponse = { error: { code: 'bad_request', message: 'Method not allowed' } };
  return new Response(JSON.stringify(body), {
    status: 405,
    headers: { ...JSON_HEADERS, allow: allow.join(', ') },
  });
}

export function tooManyRequests(retryAfterSeconds?: number): Response {
  const headers = new Headers(JSON_HEADERS);
  if (retryAfterSeconds !== undefined) headers.set('retry-after', String(retryAfterSeconds));
  const body: ErrorResponse = { error: { code: 'bad_request', message: 'Too many requests' } };
  return new Response(JSON.stringify(body), { status: 429, headers });
}

/**
 * Convert any thrown value into a safe JSON error response. Known
 * {@link GlotError}s expose their code/message/details; everything else becomes
 * an opaque `500` so internal details never leak to clients.
 */
export function toErrorResponse(error: unknown, logger: Logger): Response {
  if (isGlotError(error)) {
    if (error.status >= 500) {
      // 5xx (incl. 502 translator failures) may carry upstream/provider text in
      // `message`/`details`. Log it server-side, return a generic message so we
      // never echo internals to the client.
      logger.error(`${error.code}: ${error.message}`, { status: error.status });
      const body: ErrorResponse = {
        error: {
          code: error.code,
          message: GENERIC_5XX_MESSAGE[error.code] ?? 'Internal server error',
        },
      };
      return new Response(JSON.stringify(body), { status: error.status, headers: JSON_HEADERS });
    }
    const body: ErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
    return new Response(JSON.stringify(body), {
      status: error.status,
      headers: JSON_HEADERS,
    });
  }

  logger.error('Unhandled error in Glot Manager handler', {
    error: error instanceof Error ? error.message : String(error),
  });
  const body: ErrorResponse = {
    error: { code: 'internal_error', message: 'Internal server error' },
  };
  return new Response(JSON.stringify(body), { status: 500, headers: JSON_HEADERS });
}

export { GlotError };
