/**
 * `@glot-manager/openai` — a {@link Translator} backed by OpenAI chat models.
 *
 * Uses the official `openai` SDK (a peer dependency) with strict JSON-schema
 * response formatting. The glossary, company style guide, domain, and usage
 * context flow in through `@glot-manager/core`'s extensible prompt builder — or supply
 * your own `buildPrompt`.
 */

import OpenAI from 'openai';
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

/** The default model. */
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

/** Structural subset of the OpenAI SDK we depend on — keeps tests SDK-free. */
export interface OpenAIChatCreateParams {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  [key: string]: unknown;
}

export interface OpenAIChatResponse {
  choices: Array<{ message: { content: string | null } }>;
  [key: string]: unknown;
}

export interface OpenAIClientLike {
  chat: {
    completions: {
      create(
        params: OpenAIChatCreateParams,
        options?: { signal?: AbortSignal },
      ): Promise<OpenAIChatResponse>;
    };
  };
}

export interface OpenAITranslatorOptions {
  /** API key. Defaults to `process.env.OPENAI_API_KEY`. */
  apiKey?: string;
  /** Model id. Defaults to {@link DEFAULT_OPENAI_MODEL}. */
  model?: string;
  /** Sampling temperature. Defaults to `0.2` (faithful, low-variance output). */
  temperature?: number;
  /**
   * Use a strict `json_schema` response format. Default `true`. Disable for
   * models that only support `{ type: 'json_object' }` or none at all.
   */
  structuredOutput?: boolean;
  /** A pre-constructed client (or a fake, for tests). Skips SDK construction. */
  client?: OpenAIClientLike;
  /** Options forwarded to the `OpenAI` constructor (`baseURL`, `timeout`, …). */
  clientOptions?: Record<string, unknown>;
  /** Replace the default prompt builder entirely. */
  buildPrompt?: PromptBuilder;
  /** Tweak the default prompt (custom system preamble, extra instructions). */
  promptOptions?: BuildPromptOptions;
  /** Extra params merged into `chat.completions.create`. */
  extraCreateParams?: Record<string, unknown>;
  /** Identifier reported by the translator. Default `"openai"`. */
  id?: string;
}

function jsonSchemaResponseFormat(keys: readonly Locale[]): Record<string, unknown> {
  const properties: Record<string, { type: 'string' }> = {};
  for (const key of keys) properties[key] = { type: 'string' };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'glot_translations',
      strict: true,
      schema: {
        type: 'object',
        properties,
        required: [...keys],
        additionalProperties: false,
      },
    },
  };
}

/**
 * Create an OpenAI-backed {@link Translator}.
 *
 * @example
 * ```ts
 * import { createOpenAITranslator } from '@glot-manager/openai';
 * const translator = createOpenAITranslator({ model: 'gpt-4.1-mini' });
 * ```
 */
export function createOpenAITranslator(options: OpenAITranslatorOptions = {}): Translator {
  const model = options.model ?? DEFAULT_OPENAI_MODEL;
  const temperature = options.temperature ?? 0.2;
  const structured = options.structuredOutput ?? true;
  const build = options.buildPrompt ?? buildTranslationPrompt;
  const id = options.id ?? 'openai';

  let client = options.client;
  const getClient = (): OpenAIClientLike => {
    if (client) return client;
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new TranslatorError('OpenAI API key missing: set OPENAI_API_KEY or pass { apiKey }');
    }
    client = new OpenAI({ apiKey, ...options.clientOptions }) as unknown as OpenAIClientLike;
    return client;
  };

  return {
    id,
    async translate(
      job: TranslationJob,
      translateOptions?: TranslateOptions,
    ): Promise<LocaleValues> {
      const prompt = build(job, options.promptOptions);
      const params: OpenAIChatCreateParams = {
        model,
        temperature,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        ...(structured
          ? { response_format: jsonSchemaResponseFormat(prompt.expectedKeys) }
          : { response_format: { type: 'json_object' } }),
        ...options.extraCreateParams,
      };

      let response: OpenAIChatResponse;
      try {
        response = await getClient().chat.completions.create(
          params,
          translateOptions?.signal ? { signal: translateOptions.signal } : undefined,
        );
      } catch (error) {
        if (error instanceof TranslatorError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new TranslatorError(`OpenAI translation request failed: ${message}`, error);
      }

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new TranslatorError('OpenAI returned an empty completion');
      }
      return parseTranslationResponse(content, prompt.expectedKeys);
    },
  };
}
