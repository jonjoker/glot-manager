# @glot/openai

OpenAI translation provider for [Glot Manager](https://github.com/jonjoker/glot-manager).
Implements the `Translator` interface with strict `json_schema` output and the
glossary/company-language/context-aware prompt from `@glot/core`.

```bash
npm install @glot/openai openai
```

```ts
import { createOpenAITranslator } from '@glot/openai';

const translator = createOpenAITranslator({
  // apiKey defaults to process.env.OPENAI_API_KEY (server-only)
  model: 'gpt-4.1-mini', // default
  temperature: 0.2,
});
```

- Strict `json_schema` response format by default (set `structuredOutput: false`
  for `{ type: 'json_object' }`).
- Inject `extraCreateParams`, `promptOptions`, or a full `buildPrompt` override.
  Pass a `client` to inject your own `OpenAI` instance (or a fake, for tests).

`openai` is a **peer dependency**.

📖 Full docs: [Providers guide](https://github.com/jonjoker/glot-manager/blob/main/docs/providers.md) ·
License: MIT
