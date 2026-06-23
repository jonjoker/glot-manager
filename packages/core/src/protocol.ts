/**
 * The HTTP contract between `@glot-manager/react` (client) and `@glot-manager/server` (handler).
 *
 * Keeping these shapes in `@glot-manager/core` means the client and server can never
 * drift apart: both import the exact same request/response types.
 *
 * All endpoints are rooted at the `basePath` the server is mounted under
 * (default `/api/glot`):
 *
 * | Method | Path                       | Body / Query            | Response                |
 * | ------ | -------------------------- | ----------------------- | ----------------------- |
 * | GET    | `/entries`                 | —                       | {@link ListEntriesResponse} |
 * | GET    | `/entries/:key`            | —                       | {@link GetEntryResponse}    |
 * | PUT    | `/entries/:key`            | {@link SaveEntryRequest}    | {@link SaveEntryResponse}   |
 * | POST   | `/entries/:key/translate`  | {@link AutoTranslateRequest}| {@link AutoTranslateResponse} |
 * | GET    | `/entries/:key/usages`     | —                       | {@link UsageResponse}       |
 * | GET    | `/config`                  | —                       | {@link ConfigResponse}      |
 */

import type { EditableEntry, Locale, LocaleValues, TranslationUsage } from './types.ts';
import type { ValidationIssue } from './validation.ts';

export interface ConfigResponse {
  locales: Locale[];
  defaultLocale: Locale;
  localeNames: Record<Locale, string>;
  /** Whether a translator is configured (controls the "Auto translate" button). */
  autoTranslate: boolean;
}

export interface ListEntriesResponse {
  entries: EditableEntry[];
}

export interface GetEntryResponse {
  entry: EditableEntry;
}

export interface SaveEntryRequest {
  sourceLocale: Locale;
  values: LocaleValues;
}

export interface SaveEntryResponse {
  entry: EditableEntry;
}

export interface AutoTranslateRequest {
  sourceLocale: Locale;
  values: LocaleValues;
  /** Defaults to every configured locale except `sourceLocale`. */
  targetLocales?: Locale[];
}

export interface AutoTranslateResponse {
  /** The full merged values map (source untouched, targets filled). */
  values: LocaleValues;
  /** Non-blocking quality warnings (e.g. a target that copied the source). */
  issues?: ValidationIssue[];
}

export interface UsageResponse {
  usages: TranslationUsage[];
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
