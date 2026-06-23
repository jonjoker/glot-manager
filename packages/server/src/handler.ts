import { BadRequestError } from '@glot-manager/core';
import { resolveConfig, type GlotServerConfig, type ResolvedConfig } from './config.ts';
import { runAuthorize, type GlotPrincipal } from './auth.ts';
import { assertSameOrigin } from './security.ts';
import { matchRoute, type GlotRoute } from './router.ts';
import {
  autoTranslate,
  getConfig,
  getEntry,
  getUsages,
  listEntries,
  saveEntry,
} from './operations.ts';
import { json, methodNotAllowed, notFound, toErrorResponse, tooManyRequests } from './responses.ts';

/** A standard Web Fetch handler: `(request) => Promise<Response>`. */
export type GlotHandler = (request: Request) => Promise<Response>;

/**
 * Create the Glot Manager request handler.
 *
 * The returned function is a plain Web-Fetch handler, so it plugs directly into
 * any runtime built on the Fetch standard (Next.js App Router, Remix, Hono,
 * Bun, Deno, Cloudflare Workers). For Node's `http`/Express, wrap it with the
 * adapters in `@glot-manager/server/node` and `@glot-manager/server/express`.
 *
 * @example
 * ```ts
 * // app/api/glot/[...path]/route.ts (Next.js App Router)
 * import { createGlotHandler } from '@glot-manager/server';
 * import { toNextHandler } from '@glot-manager/server/next';
 *
 * const handler = createGlotHandler({ store, locales, authorize, translator });
 * export const { GET, PUT, POST } = toNextHandler(handler);
 * ```
 */
export function createGlotHandler(config: GlotServerConfig): GlotHandler {
  const resolved = resolveConfig(config);

  return async function glotHandler(request: Request): Promise<Response> {
    const startedAt = Date.now();
    let routeName = 'unknown';
    try {
      const url = new URL(request.url);
      const matched = matchRoute(url.pathname, resolved.basePath);
      if (matched === null) return notFound();
      if (matched === 'unknown') return notFound('No such Glot Manager endpoint');

      routeName = matched.route.name;
      if (!matched.allow.includes(request.method)) {
        return methodNotAllowed(matched.allow);
      }

      const isMutation = request.method === 'PUT' || request.method === 'POST';
      if (isMutation && !resolved.disableCsrfProtection) {
        assertSameOrigin(request, resolved.allowedOrigins);
      }

      const principal = await runAuthorize(resolved.authorize, request);

      if (resolved.rateLimit) {
        const limit = await resolved.rateLimit(request, {
          route: routeName,
          userId: principal.userId ?? null,
        });
        if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);
      }

      const response = await dispatch(resolved, matched.route, request, principal);
      logRequest(resolved, request, routeName, response.status, startedAt);
      return response;
    } catch (error) {
      const response = toErrorResponse(error, resolved.logger);
      logRequest(resolved, request, routeName, response.status, startedAt);
      return response;
    }
  };
}

async function dispatch(
  config: ResolvedConfig,
  route: GlotRoute,
  request: Request,
  principal: GlotPrincipal,
): Promise<Response> {
  switch (route.name) {
    case 'config':
      return json(getConfig(config));
    case 'entries':
      return json(await listEntries(config));
    case 'entry':
      if (request.method === 'GET') return json(await getEntry(config, route.key));
      return json(await saveEntry(config, route.key, await readJson(request), principal));
    case 'translate':
      return json(await autoTranslate(config, route.key, await readJson(request)));
    case 'usages':
      return json(await getUsages(config, route.key));
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequestError('Invalid JSON request body');
  }
}

function logRequest(
  config: ResolvedConfig,
  request: Request,
  route: string,
  status: number,
  startedAt: number,
): void {
  config.logger.info('request', {
    method: request.method,
    route,
    status,
    durationMs: Date.now() - startedAt,
  });
}
