# @glot/anthropic

Anthropic (Claude) translation provider for [Glot Manager](https://github.com/jonjoker/glot-manager).
Implements the `Translator` interface with structured JSON output and the
glossary/company-language/context-aware prompt from `@glot/core`.

```bash
npm install @glot/anthropic @anthropic-ai/sdk
```

```ts
import { createAnthropicTranslator } from '@glot/anthropic';

const translator = createAnthropicTranslator({
  // apiKey defaults to process.env.ANTHROPIC_API_KEY (server-only)
  model: 'claude-opus-4-8', // default
});
```

- Defaults to **`claude-opus-4-8`** (highest quality). For high-volume UI
  translation, `claude-sonnet-4-6` / `claude-haiku-4-5` are cheaper and strong.
- Uses `output_config.format` (json_schema) for reliable structured output.
- Inject `extraCreateParams` (e.g. `effort`, `thinking`), `promptOptions`, or a
  full `buildPrompt` override. Pass a `client` to inject your own
  `Anthropic` instance (or a fake, for tests).

`@anthropic-ai/sdk` is a **peer dependency**.

📖 Full docs: [Providers guide](https://github.com/jonjoker/glot-manager/blob/main/docs/providers.md) ·
License: MIT
