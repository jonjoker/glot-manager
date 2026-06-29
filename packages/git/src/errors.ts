/**
 * Typed errors for `@glot-manager/git`.
 *
 * These are intentionally standalone (they extend `Error`, not the server's
 * `GlotError`) so the package stays usable without the HTTP layer. Each carries
 * a stable, machine-readable {@link GitSyncErrorCode} so callers — and the
 * optional publish endpoint — can branch on the failure mode.
 *
 * Expected outcomes (a clean no-op, a detected conflict surfaced in a diff) are
 * returned as data, never thrown. Throwing is reserved for I/O, auth, and
 * programmer errors.
 */

/** Stable, machine-readable failure modes. */
export type GitSyncErrorCode =
  | 'invalid_config'
  | 'invalid_locale_file'
  | 'invalid_path_pattern'
  | 'backend_error'
  | 'rate_limited'
  | 'auth_failed'
  | 'ref_not_found'
  | 'non_fast_forward'
  | 'aborted'
  | 'not_supported';

export class GitSyncError extends Error {
  readonly code: GitSyncErrorCode;
  /** HTTP-ish status, surfaced if this bubbles through a publish endpoint. */
  readonly status: number;

  constructor(
    message: string,
    options: { code?: GitSyncErrorCode; status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GitSyncError';
    this.code = options.code ?? 'backend_error';
    this.status = options.status ?? 502;
  }
}

/** The repository tip advanced since we read it — the only real "conflict". */
export class NonFastForwardError extends GitSyncError {
  /** The commit we based our change on. */
  readonly base: string;
  /** The branch we tried to advance. */
  readonly branch: string;

  constructor(branch: string, base: string, options: { cause?: unknown } = {}) {
    super(`Branch "${branch}" advanced past ${base.slice(0, 8)} — retry against the new tip`, {
      code: 'non_fast_forward',
      status: 409,
      ...options,
    });
    this.name = 'NonFastForwardError';
    this.branch = branch;
    this.base = base;
  }
}

/** A branch or commit does not exist on the remote. */
export class RefNotFoundError extends GitSyncError {
  readonly ref: string;
  constructor(ref: string, options: { cause?: unknown } = {}) {
    super(`Ref "${ref}" was not found`, { code: 'ref_not_found', status: 404, ...options });
    this.name = 'RefNotFoundError';
    this.ref = ref;
  }
}

/** Authentication or authorization against the git host failed. */
export class GitAuthError extends GitSyncError {
  constructor(message = 'Git authentication failed', options: { cause?: unknown } = {}) {
    super(message, { code: 'auth_failed', status: 401, ...options });
    this.name = 'GitAuthError';
  }
}

/** A capability (e.g. opening a pull request) the chosen backend does not support. */
export class NotSupportedError extends GitSyncError {
  constructor(message: string) {
    super(message, { code: 'not_supported', status: 400 });
    this.name = 'NotSupportedError';
  }
}

/** Invalid configuration (bad path pattern, missing credentials, …). */
export class GitConfigError extends GitSyncError {
  constructor(message: string, code: GitSyncErrorCode = 'invalid_config') {
    super(message, { code, status: 500 });
    this.name = 'GitConfigError';
  }
}

/** The git host is rate-limiting (e.g. GitHub secondary rate limit). Retryable. */
export class RateLimitedError extends GitSyncError {
  constructor(message = 'Rate limited by the git host', options: { cause?: unknown } = {}) {
    super(message, { code: 'rate_limited', status: 429, ...options });
    this.name = 'RateLimitedError';
  }
}

/** The operation was aborted via an `AbortSignal`. */
export class AbortedError extends GitSyncError {
  constructor(message = 'Operation aborted') {
    super(message, { code: 'aborted', status: 499 });
    this.name = 'AbortedError';
  }
}

/** Narrow an unknown thrown value to a {@link GitSyncError}. */
export function isGitSyncError(value: unknown): value is GitSyncError {
  return value instanceof GitSyncError;
}
