# FAQ

### Does Glot Manager replace next-intl / i18next / react-intl?

No. Glot Manager is the **editing and AI layer** on top of whatever i18n runtime you
already use. You keep rendering text however you do today; `<T id>` just makes a
string editable and gives the editor a key. You can also serve messages straight
from Glot Manager's store via `buildMessageTree` if you'd rather not run a separate i18n
library.

### Do edits require a redeploy or a CDN purge?

No. Messages are read from your database at request time, so an edit is live on
the next render. Cache reads if you like, and bust them in `onChange`.

### Will end users download the editor?

No. The editor UI is code-split and only loads for authorized admins who turn on
edit mode. There are also **no invisible Unicode markers** in the production DOM
(a known source of bugs in marker-based tools).

### Which LLM should I use?

`@glot/anthropic` defaults to `claude-opus-4-8` (highest quality). For
high-volume UI translation, `claude-sonnet-4-6` or `claude-haiku-4-5` are much
cheaper and still strong. `@glot/openai` defaults to `gpt-4.1-mini`. Or write
your own `Translator`.

### How do I make the AI use our terminology and voice?

Pass a `TranslationContext` (domain, style guide, glossary, per-locale tone) to
the handler — statically or per request. See
[glossary-and-context.md](./glossary-and-context.md).

### Can non-React frontends use Glot Manager?

The editor client is React, but the server is framework-agnostic and the
[HTTP API](./server.md#http-api) is documented — a Vue/Svelte/vanilla editor can
talk to it directly.

### Is it secure to let admins edit production copy?

Authorization is enforced server-side on every request, the LLM key never leaves
the server, editable keys are allow-listed, CSRF is blocked, and inputs are
validated. See [security.md](./security.md).

### What about pluralization / ICU?

Glot Manager preserves ICU plural/select syntax and `{placeholders}` during translation
and validates that they survive. The editor edits the raw ICU string; your i18n
runtime formats it at render time as usual.

### How do I keep translations from drifting (missing locales, broken placeholders)?

Run `auditEntries` from `@glot/core` in CI — it flags missing locales, placeholder/
markup mismatches, suspicious copies, and key collisions. See
[self-hosting.md](./self-hosting.md#5-keeping-translations-healthy-in-ci).

### Can two admins edit at once?

Saves are last-write-wins per key at the store level. For teams with heavy
concurrent editing, add optimistic concurrency in a custom store (e.g. compare
`updated_at`).
