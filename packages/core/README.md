# @glot/core

Framework-agnostic core for [Glot Manager](https://github.com/jonjoker/glot-manager) — the
in-context, AI-native translation editor. Zero runtime dependencies.

Everything the client, server, providers, and stores share lives here:

- **Types** — `TranslationEntry`, `TranslationStore`, `Translator`,
  `TranslationContext`, `GlossaryTerm`, and the HTTP `protocol` shapes.
- **Validation** — ICU / `{placeholder}` / `%s` / `<tag>` / newline extraction
  and parity checking (`diffTokens`, `validateTranslationValues`).
- **Prompt engine** — `buildTranslationPrompt` injects glossary, domain, style
  guide, per-locale tone, and usages; selects only the glossary terms present in
  a string.
- **Stores** — `MemoryStore` (dev/test) and the `TranslationStore` interface.
- **Utilities** — prototype-pollution-safe key helpers, `buildMessageTree`,
  `auditEntries` (a CI-ready consistency checker), and `createEchoTranslator`
  (offline translator for tests).

```ts
import {
  buildTranslationPrompt,
  parseTranslationResponse,
  validateTranslationValues,
  MemoryStore,
} from '@glot/core';
```

You usually install this transitively via `@glot/server` / `@glot/react`. Install
it directly when writing a custom store, translator, or non-React client.

📖 Full docs: <https://github.com/jonjoker/glot-manager> · License: MIT
