/**
 * Typed errors with stable machine codes and HTTP status hints.
 *
 * The server handler maps any thrown {@link GlotError} to a JSON error response
 * using `code` and `status`; anything else becomes an opaque 500.
 */

/** Machine-readable error codes returned over the wire. */
export type GlotErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'translator_failed'
  | 'config_error'
  | 'internal_error';

export class GlotError extends Error {
  readonly code: GlotErrorCode;
  readonly status: number;
  /** Optional structured details surfaced to clients (must be safe to expose). */
  readonly details?: unknown;

  constructor(
    message: string,
    options: { code: GlotErrorCode; status: number; details?: unknown; cause?: unknown } = {
      code: 'internal_error',
      status: 500,
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GlotError';
    this.code = options.code;
    this.status = options.status;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class BadRequestError extends GlotError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, { code: 'bad_request', status: 400, details });
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends GlotError {
  constructor(message = 'Authentication required') {
    super(message, { code: 'unauthorized', status: 401 });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends GlotError {
  constructor(message = 'You do not have permission to edit translations') {
    super(message, { code: 'forbidden', status: 403 });
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends GlotError {
  constructor(message = 'Not found') {
    super(message, { code: 'not_found', status: 404 });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends GlotError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, { code: 'validation_failed', status: 422, details });
    this.name = 'ValidationError';
  }
}

export class TranslatorError extends GlotError {
  constructor(message = 'The translation provider failed', cause?: unknown) {
    super(message, { code: 'translator_failed', status: 502, cause });
    this.name = 'TranslatorError';
  }
}

export class ConfigError extends GlotError {
  constructor(message = 'Glot Manager is misconfigured') {
    super(message, { code: 'config_error', status: 500 });
    this.name = 'ConfigError';
  }
}

/** Narrow an unknown thrown value to a {@link GlotError}. */
export function isGlotError(value: unknown): value is GlotError {
  return value instanceof GlotError;
}
