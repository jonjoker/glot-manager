import type { IncomingMessage, ServerResponse } from 'node:http';

/** Internal: bridge Node `http` primitives to the Web Fetch standard. */

export interface BridgeOptions {
  trustProxy?: boolean;
  /**
   * A pre-parsed body (e.g. Express's `req.body` after `express.json()`). When
   * present and the request has a body method, it is used instead of reading
   * the (already-consumed) stream.
   */
  parsedBody?: unknown;
  /** Absolute URL override (Express knows `originalUrl`; Node must reconstruct). */
  url?: string;
}

export async function nodeRequestToWeb(
  req: IncomingMessage,
  options: BridgeOptions = {},
): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const url = options.url ?? reconstructUrl(req, options.trustProxy ?? false);
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let body: string | Uint8Array | undefined;
  if (hasBody) {
    if (options.parsedBody !== undefined) {
      body = encodeParsedBody(options.parsedBody, headers);
    } else {
      const raw = await readStream(req);
      if (raw.length > 0) body = raw;
    }
  }

  return new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body: body as BodyInit } : {}),
  });
}

export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function reconstructUrl(req: IncomingMessage, trustProxy: boolean): string {
  const forwardedProto = trustProxy ? req.headers['x-forwarded-proto'] : undefined;
  const proto =
    (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : undefined) ??
    ('encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http');
  const forwardedHost = trustProxy ? req.headers['x-forwarded-host'] : undefined;
  const host =
    (typeof forwardedHost === 'string' ? forwardedHost : undefined) ??
    req.headers.host ??
    'localhost';
  return new URL(req.url ?? '/', `${proto}://${host}`).toString();
}

function encodeParsedBody(parsedBody: unknown, headers: Headers): string | Uint8Array | undefined {
  if (parsedBody === undefined || parsedBody === null) return undefined;
  if (typeof parsedBody === 'string') return parsedBody;
  if (parsedBody instanceof Uint8Array) return parsedBody;
  // Object/array: serialize as JSON so the handler can `request.json()` it.
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return JSON.stringify(parsedBody);
}

function readStream(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
