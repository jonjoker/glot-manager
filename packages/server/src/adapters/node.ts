import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GlotHandler } from '../handler.ts';
import { nodeRequestToWeb, writeWebResponse } from './web-bridge.ts';

export interface NodeAdapterOptions {
  /**
   * Trust `X-Forwarded-Proto` / `X-Forwarded-Host` when reconstructing the
   * absolute URL (enable behind a proxy you control). Default `false`.
   */
  trustProxy?: boolean;
}

/**
 * Adapt a {@link GlotHandler} to a Node `http` request listener, bridging
 * `IncomingMessage`/`ServerResponse` to the Web `Request`/`Response` standard.
 *
 * @example
 * ```ts
 * import { createServer } from 'node:http';
 * import { createGlotHandler } from '@glot-manager/server';
 * import { toNodeHandler } from '@glot-manager/server/node';
 *
 * const node = toNodeHandler(createGlotHandler({  ...  }));
 * createServer((req, res) => { void node(req, res); }).listen(3000);
 * ```
 */
export function toNodeHandler(
  handler: GlotHandler,
  options: NodeAdapterOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async function nodeHandler(req, res) {
    try {
      const request = await nodeRequestToWeb(req, { trustProxy: options.trustProxy ?? false });
      const response = await handler(request);
      await writeWebResponse(res, response);
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
      }
      res.end(
        JSON.stringify({ error: { code: 'internal_error', message: 'Internal server error' } }),
      );
      console.error('[glot] node adapter error', error);
    }
  };
}
