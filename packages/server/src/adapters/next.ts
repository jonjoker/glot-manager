import type { GlotHandler } from '../handler.ts';

/**
 * The shape Next.js App Router route files export: one function per HTTP method,
 * each receiving a Web `Request`.
 */
export interface NextRouteHandlers {
  GET: (request: Request) => Promise<Response>;
  PUT: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

/**
 * Adapt a {@link GlotHandler} to Next.js App Router route handlers.
 *
 * Next.js route handlers already speak the Web Fetch `Request`/`Response`
 * standard, so this is a thin pass-through that exposes the right method names.
 *
 * @example
 * ```ts
 * // app/api/glot/[...path]/route.ts
 * import { createGlotHandler } from '@glot-manager/server';
 * import { toNextHandler } from '@glot-manager/server/next';
 *
 * const handler = createGlotHandler({  ...  });
 * export const { GET, PUT, POST } = toNextHandler(handler);
 * ```
 */
export function toNextHandler(handler: GlotHandler): NextRouteHandlers {
  return {
    GET: (request) => handler(request),
    PUT: (request) => handler(request),
    POST: (request) => handler(request),
  };
}
