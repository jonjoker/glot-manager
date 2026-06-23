/**
 * Minimal structured logger interface plus a safe default.
 *
 * Crucially, the default logger sanitizes values: it strips CR/LF (log
 * injection, OWASP A09) and redacts anything that looks like a secret/token
 * before writing. Provide your own `logger` to route into your platform.
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|token|secret|password|cookie)/i;
const MAX_DEPTH = 4;

/**
 * Recursively sanitize a value for logging: strip CR/LF from every string (so
 * user-controlled content can't forge log lines, OWASP A09), and redact values
 * whose key looks like a secret — at every nesting level, up to a depth cap.
 */
export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.replace(/[\r\n]+/g, ' ').slice(0, 2000);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeLogValue(child, depth + 1);
  }
  return out;
}

/** Redact secret-looking fields and strip CR/LF from a metadata object. */
export function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  return sanitizeLogValue(meta) as Record<string, unknown>;
}

export function createDefaultLogger(prefix = '[glot]'): Logger {
  const emit = (
    level: 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    const safeMessage = String(sanitizeLogValue(message));
    const safeMeta = sanitizeMeta(meta);
    const line = `${prefix} ${safeMessage}`;
    if (safeMeta) console[level](line, safeMeta);
    else console[level](line);
  };
  return {
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
  };
}

/** A logger that does nothing — useful in tests. */
export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
