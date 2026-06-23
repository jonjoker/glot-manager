# Providers & the LLM engine

A **translator** is anything implementing the `Translator` interface from
`@glot/core`:

```ts
interface Translator {
  readonly id: string;
  translate(job: TranslationJob, options?: { signal?: AbortSignal }): Promise<LocaleValues>;
}
```

Glot Manager ships two: `@glot/anthropic` (Claude) and `@glot/openai` (GPT). You can also
write your own, or use the offline `createEchoTranslator()` from `@glot/core` for
local development and tests.

## Anthropic (Claude)

```ts
import { createAnthropicTranslator } from '@glot/anthropic';

const translator = createAnthropicTranslator({
  // apiKey defaults to process.env.ANTHROPIC_API_KEY
  model: 'claude-opus-4-8', // default; see below
});
```

| Option              | Default                         | Notes                                                         |
| ------------------- | ------------------------------- | ------------------------------------------------------------- |
| `apiKey`            | `process.env.ANTHROPIC_API_KEY` | Server-only.                                                  |
| `model`             | `'claude-opus-4-8'`             | See model guidance below.                                     |
| `maxTokens`         | `2048`                          | UI strings are short.                                         |
| `structuredOutput`  | `true`                          | Uses `output_config.format` (json_schema).                    |
| `buildPrompt`       | default builder                 | Replace the prompt entirely.                                  |
| `promptOptions`     | —                               | Tweak the default prompt (custom system, extra instructions). |
| `extraCreateParams` | —                               | Merged into `messages.create` (e.g. `effort`, `thinking`).    |
| `client`            | —                               | Inject a pre-built `Anthropic` client (or a fake, for tests). |

`@anthropic-ai/sdk` is a **peer dependency** — install it alongside.

**Model choice.** `claude-opus-4-8` is the most capable default. For high-volume
UI translation where cost/latency matter, `claude-sonnet-4-6` or
`claude-haiku-4-5` are excellent and much cheaper:

```ts
createAnthropicTranslator({
  model: 'claude-sonnet-4-6',
  extraCreateParams: { output_config: { effort: 'low' } },
});
```

## OpenAI

```ts
import { createOpenAITranslator } from '@glot/openai';

const translator = createOpenAITranslator({
  // apiKey defaults to process.env.OPENAI_API_KEY
  model: 'gpt-4.1-mini',
  temperature: 0.2,
});
```

Uses a strict `json_schema` response format by default (set
`structuredOutput: false` to fall back to `{ type: 'json_object' }`). `openai` is
a peer dependency.

## The prompt is extensible — three levels

Every provider builds its prompt from `@glot/core`'s `buildTranslationPrompt`,
which injects the glossary, domain, style guide, per-locale tone, and on-page
usages (see [glossary-and-context.md](./glossary-and-context.md)).

**1. Add context** (most common) — via the handler's `context` /
`contextProvider`. No code changes to the provider.

**2. Tweak the prompt** — `promptOptions`:

```ts
createAnthropicTranslator({
  promptOptions: {
    extraInstructions: 'Keep button labels under 20 characters.',
  },
});
```

**3. Replace the prompt builder** — full control:

```ts
import { type PromptBuilder } from '@glot/core';

const buildPrompt: PromptBuilder = (job) => ({
  system: 'You are our in-house translator. Follow the brand bible.',
  user: `Translate ${JSON.stringify(job.sourceText)} into ${job.targetLocales.join(', ')}. Return JSON.`,
  expectedKeys: job.targetLocales,
});

createAnthropicTranslator({ buildPrompt });
```

## Writing a custom provider

Implement the interface — e.g. an on-prem model, a different SaaS, or a glossary
lookup with no LLM:

```ts
import { buildTranslationPrompt, parseTranslationResponse, type Translator } from '@glot/core';

export function myTranslator(): Translator {
  return {
    id: 'my-model',
    async translate(job) {
      const { system, user, expectedKeys } = buildTranslationPrompt(job);
      const raw = await callMyModel(system, user);
      return parseTranslationResponse(raw, expectedKeys); // validates all targets are present
    },
  };
}
```

## Output validation

After a translation, the server validates the result with
`validateTranslationValues`: every target locale must be present, non-empty, and
preserve the source's `{placeholders}`, ICU plurals, `%s`, and `<tags>`.
Mismatches come back as non-blocking `issues` in the auto-translate response so
the editor can warn before the admin saves.
