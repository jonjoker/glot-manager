import { BadRequestError, ForbiddenError } from '@glot-manager/core';

/**
 * CSRF protection for state-changing requests, without tokens.
 *
 * Strategy (per the OWASP CSRF cheat sheet):
 * 1. `Sec-Fetch-Site` is set by the browser and cannot be forged from JS. Only
 *    `same-origin` and `none` are trusted; `same-site` and `cross-site` requests
 *    are rejected unless they carry an `Origin` that is same-origin or in
 *    `allowedOrigins` (a missing `Origin` in those cases is rejected, not trusted).
 * 2. When `Origin` is present, require it to be same-origin or in `allowedOrigins`.
 * 3. Require `Content-Type: application/json`, which forces a CORS preflight for
 *    cross-origin callers and blocks simple-form-based CSRF.
 *
 * GET requests are not checked (they must remain side-effect free).
 */
export function assertSameOrigin(request: Request, allowedOrigins: readonly string[]): void {
  const fetchSite = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');

  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    // same-site or cross-site: require an explicitly allowed Origin (no Origin → reject).
    if (!origin || !isOriginAllowed(request, allowedOrigins)) {
      throw new ForbiddenError('Cross-site request blocked');
    }
  }

  if (origin && !isOriginAllowed(request, allowedOrigins)) {
    throw new ForbiddenError('Origin not allowed');
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new BadRequestError('Content-Type must be application/json');
  }
}

function isOriginAllowed(request: Request, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // No Origin header → not a CORS request.

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    requestOrigin = '';
  }
  if (origin === requestOrigin) return true;
  return allowedOrigins.includes(origin);
}
