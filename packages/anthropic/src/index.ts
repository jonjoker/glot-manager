/**
 * `@glot-manager/anthropic` — a {@link Translator} backed by Anthropic's Claude models.
 *
 * Uses the official `@anthropic-ai/sdk` (a peer dependency) and the Messages API
 * with structured JSON output. The glossary, company "style guide", domain, and
 * usage context all flow in through `@glot-manager/core`'s extensible prompt builder —
 * or supply your own `buildPrompt` to take full control.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  buildTranslationPrompt,
  parseTranslationResponse,
  TranslatorError,
  type BuildPromptOptions,
  type Locale,
  type LocaleValues,
  type PromptBuilder,
  type TranslateOptions,
  type TranslationJob,
  type Translator,
} from '@glot-manager/core';

/** The default model. Override for cheaper/faster translation (see README). */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

/** Structural subset of the Anthropic SDK we depend on — keeps tests SDK-free. */
export interface AnthropicMessagesCreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  [key: string]: unknown;
}

export interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  [key: string]: unknown;
}

export interface AnthropicClientLike {
  messages: {
    create(
      params: AnthropicMessagesCreateParams,
      options?: { signal?: AbortSignal },
    ): Promise<AnthropicMessageResponse>;
  };
}

export interface AnthropicTranslatorOptions {
  /** API key. Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Model id. Defaults to {@link DEFAULT_ANTHROPIC_MODEL}. */
  model?: string;
  /** Max output tokens. Defaults to `2048` (UI strings are short). */
  maxTokens?: number;
  /**
   * Request structured JSON output via `output_config.format`. Default `true`.
   * Disable for models/gateways that don't support it (the prompt also asks for
   * JSON, so parsing still works).
   */
  structuredOutput?: boolean;
  /** A pre-constructed client (or a fake, for tests). Skips SDK construction. */
  client?: AnthropicClientLike;
  /** Options forwarded to the `Anthropic` constructor (`baseURL`, `timeout`, …). */
  clientOptions?: Record<string, unknown>;
  /** Replace the default prompt builder entirely. */
  buildPrompt?: PromptBuilder;
  /** Tweak the default prompt (custom system preamble, extra instructions). */
  promptOptions?: BuildPromptOptions;
  /** Extra params merged into `messages.create` (e.g. `effort`, `thinking`). */
  extraCreateParams?: Record<string, unknown>;
  /** Identifier reported by the translator. Default `"anthropic"`. */
  id?: string;
}

function jsonSchemaFormat(keys: readonly Locale[]): Record<string, unknown> {
  const properties: Record<string, { type: 'string' }> = {};
  for (const key of keys) properties[key] = { type: 'string' };
  return {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties,
      required: [...keys],
      additionalProperties: false,
    },
  };
}

function extractText(response: AnthropicMessageResponse): string {
  return response.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/**
 * Create an Anthropic-backed {@link Translator}.
 *
 * @example
 * ```ts
 * import { createAnthropicTranslator } from '@glot-manager/anthropic';
 * const translator = createAnthropicTranslator({ model: 'claude-sonnet-4-6' });
 * ```
 */
export function createAnthropicTranslator(options: AnthropicTranslatorOptions = {}): Translator {
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const maxTokens = options.maxTokens ?? 2048;
  const structured = options.structuredOutput ?? true;
  const build = options.buildPrompt ?? buildTranslationPrompt;
  const id = options.id ?? 'anthropic';

  let client = options.client;
  const getClient = (): AnthropicClientLike => {
    if (client) return client;
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new TranslatorError(
        'Anthropic API key missing: set ANTHROPIC_API_KEY or pass { apiKey }',
      );
    }
    client = new Anthropic({ apiKey, ...options.clientOptions }) as unknown as AnthropicClientLike;
    return client;
  };

  return {
    id,
    async translate(
      job: TranslationJob,
      translateOptions?: TranslateOptions,
    ): Promise<LocaleValues> {
      const prompt = build(job, options.promptOptions);
      const params: AnthropicMessagesCreateParams = {
        model,
        max_tokens: maxTokens,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        ...options.extraCreateParams,
      };
      if (structured) {
        // Layer the json_schema format on top of any user-supplied `output_config`
        // (e.g. `{ effort: 'high' }`) instead of letting extraCreateParams drop it.
        const existing =
          typeof params.output_config === 'object' && params.output_config !== null
            ? (params.output_config as Record<string, unknown>)
            : {};
        params.output_config = { ...existing, format: jsonSchemaFormat(prompt.expectedKeys) };
      }

      let response: AnthropicMessageResponse;
      try {
        response = await getClient().messages.create(
          params,
          translateOptions?.signal ? { signal: translateOptions.signal } : undefined,
        );
      } catch (error) {
        if (error instanceof TranslatorError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new TranslatorError(`Anthropic translation request failed: ${message}`, error);
      }

      return parseTranslationResponse(extractText(response), prompt.expectedKeys);
    },
  };
}
