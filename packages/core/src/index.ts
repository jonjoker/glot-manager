/**
 * `@glot-manager/core` — framework-agnostic core for Glot Manager.
 *
 * Zero runtime dependencies, zero React, zero Node built-ins required at the
 * type level. Everything the client, server, providers, and stores share lives
 * here: the domain types, the HTTP protocol, validation, the glossary/context
 * engine, the extensible prompt builder, and the in-memory store.
 */

export const VERSION = '0.1.0';

export * from './types.ts';
export * from './protocol.ts';
export * from './errors.ts';
export * from './locale.ts';
export * from './key.ts';
export * from './message-tree.ts';
export * from './validation.ts';
export * from './glossary.ts';
export * from './context.ts';
export * from './prompt.ts';
export * from './translator.ts';
export * from './normalize.ts';
export * from './memory-store.ts';
export * from './usage.ts';
export * from './audit.ts';
