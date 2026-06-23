import { ForbiddenError, isGlotError } from '@glot-manager/core';

/** The (optional) principal an {@link Authorizer} may return. */
export interface GlotPrincipal {
  /** Stable user id, recorded as `updated_by` on saves. */
  userId?: string | null;
  [key: string]: unknown;
}

/**
 * The value an {@link Authorizer} may return:
 * - `true` / a principal object → authorized (admin)
 * - `false` / `null` / `undefined` → rejected (`403`)
 *
 * To distinguish 401 vs 403, throw `new UnauthorizedError()` from the authorizer.
 */
export type AuthResult = boolean | GlotPrincipal | null | undefined;

/**
 * Authorize a request. Runs first on every Glot Manager endpoint. The library is
 * deliberately auth-agnostic: read your own session/JWT/cookie here.
 */
export type Authorizer = (request: Request) => AuthResult | Promise<AuthResult>;

/**
 * Run the authorizer and normalize the result to a principal, throwing
 * {@link ForbiddenError} when rejected. Authorizer-thrown {@link GlotError}s
 * (e.g. `UnauthorizedError`) propagate unchanged.
 */
export async function runAuthorize(
  authorize: Authorizer,
  request: Request,
): Promise<GlotPrincipal> {
  let result: AuthResult;
  try {
    result = await authorize(request);
  } catch (error) {
    if (isGlotError(error)) throw error;
    throw new ForbiddenError();
  }

  if (result === false || result === null || result === undefined) {
    throw new ForbiddenError();
  }
  if (result === true) return {};
  return result;
}
