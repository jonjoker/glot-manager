import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GlotHandler } from '../handler.ts';
import { nodeRequestToWeb, writeWebResponse } from './web-bridge.ts';

/**
 * Minimal structural type for an Express request. Express's `req` extends Node's
 * `IncomingMessage`, plus the few fields we read. Typed structurally so the
 * adapter never depends on `@types/express`.
 */
export interface ExpressLikeRequest extends IncomingMessage {
  /** Parsed body when `express.json()` (or similar) ran before this handler. */
  body?: unknown;
  /** The full original URL including query string. */
  originalUrl?: string;
  /** `'http'` | `'https'`, set by Express based on `trust proxy`. */
  protocol?: string;
  /** Express header accessor. */
  get?(name: string): string | undefined;
}

export type ExpressNext = (error?: unknown) => void;

/**
 * Adapt a {@link GlotHandler} to Express middleware.
 *
 * Works whether or not a body parser (e.g. `express.json()`) ran first: if
 * `req.body` is already parsed it is re-serialized, otherwise the raw stream is
 * read.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { createGlotHandler } from '@glot-manager/server';
 * import { toExpressHandler } from '@glot-manager/server/express';
 *
 * const app = express();
 * app.use('/api/glot', toExpressHandler(createGlotHandler({  ...  })));
 * ```
 */
export function toExpressHandler(
  handler: GlotHandler,
): (req: ExpressLikeRequest, res: ServerResponse, next?: ExpressNext) => void {
  return function expressHandler(req, res, next) {
    void (async () => {
      try {
        const url = resolveExpressUrl(req);
        const request = await nodeRequestToWeb(req, {
          ...(url ? { url } : {}),
          ...(req.body !== undefined ? { parsedBody: req.body } : {}),
        });
        const response = await handler(request);
        await writeWebResponse(res, response);
      } catch (error) {
        if (next) next(error);
        else {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
          }
          res.end(
            JSON.stringify({ error: { code: 'internal_error', message: 'Internal server error' } }),
          );
        }
      }
    })();
  };
}

function resolveExpressUrl(req: ExpressLikeRequest): string | undefined {
  const host = req.get?.('host') ?? req.headers.host;
  if (!host) return undefined;
  const proto = req.protocol ?? 'http';
  const path = req.originalUrl ?? req.url ?? '/';
  try {
    return new URL(path, `${proto}://${host}`).toString();
  } catch {
    return undefined;
  }
}
