# @glot-manager/git

Git sync for [Glot Manager](https://github.com/jonjoker/glot-manager). Treat your
website's repo of JSON language files as the **source of truth**: import them into
a `TranslationStore`, let admins edit in context, then **publish** the changed
keys back as one commit or pull request — which triggers your normal deploy.

```bash
npm install @glot-manager/git
```

- 🌳 **Repo is the truth.** `import` seeds your store from the committed
  `en.json` / `de.json`; `publish` writes a deliberate commit/PR. Edits live in
  your store until you choose to ship them.
- 🔌 **Pluggable backend.** Ships a GitHub backend (Git-Data API over `fetch`,
  zero deps, opens PRs, runs on the edge) and a system-`git` backend
  (`child_process`, for CI / self-hosted). Bring your own by implementing one
  interface.
- 🎯 **Minimal, reviewable diffs.** A content-level **targeted merge** changes
  only the keys you edited and preserves keys another writer added concurrently.
  2-space JSON, trailing newline, no BOM, no `\uXXXX` escaping.
- ♻️ **Idempotent & safe.** A clean snapshot is a no-op (never an empty commit);
  a non-fast-forward is retried against the new tip; the auth token is sent only
  in an in-memory header — never in a URL, argv, or on disk.
- 🧩 **Zero runtime dependencies** beyond `@glot-manager/core`.

---

## The model

```
import (git → store)        edit in context (store only)        publish (store → git)
   en.json ─┐                                                     ┌─→ commit/PR ─→ deploy
   de.json ─┴─→ TranslationStore  ──→  admin edits, saved to DB  ─┘
```

Your live site keeps reading its committed language files through its normal i18n
build. Glot Manager is the authoring layer; **publish = git push = deploy**.

## 60-second quickstart

```ts
import { createGitTranslationStore } from '@glot-manager/git';
import { createGitHubBackend } from '@glot-manager/git/github';

const git = createGitTranslationStore({
  backend: createGitHubBackend({
    owner: 'acme',
    repo: 'website',
    token: process.env.GLOT_GIT_TOKEN!, // GitHub App installation token or fine-grained PAT
  }),
  pattern: 'messages/{locale}.json',     // or 'locales/{locale}/{namespace}.json'
  locales: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' },
  branch: 'main',
});

// 1. Seed your store from the repo.
const { entries } = await git.import();
for (const entry of entries) await store.upsert(entry);

// 2. …admins edit in context (handled by @glot-manager/server + @glot-manager/react)…

// 3. Publish the working copy when you're done.
const result = await git.publish({
  entries: await store.list(),
  target: { mode: 'commit', branch: 'main' }, // or { mode: 'pull-request', branch: 'glot/publish', base: 'main' }
  message: (diff) => `chore(i18n): ${diff.summary.modified} updated, ${diff.summary.added} added`,
});
// → { applied, diff, commit?, pullRequest? }   (applied === false on a no-op)
```

## Wire it to Glot's save flow

Saves fire `config.onChange(changedKeys)`. Don't publish there — accumulate the
dirty keys and publish on an explicit action:

```ts
import { wireGitPublish } from '@glot-manager/git';
import { createGitHubBackend } from '@glot-manager/git/github';

const publisher = wireGitPublish({
  store,                                  // your TranslationStore
  backend: createGitHubBackend({ owner, repo, token }),
  pattern: 'messages/{locale}.json',
  locales,
  branch: 'main',
});

// In createGlotHandler({ ... }):
//   onChange: publisher.onChange,        // records dirty keys; never publishes

// In your POST /api/glot/publish route (admin-only):
export async function POST() {
  return Response.json(await publisher.handlePublish());
}
// publisher.hasPendingChanges() powers a "publish needed" badge.
```

## Backends

| Backend | Import | Runtime dep | Working tree | Opens PRs | Use for |
|---|---|---|---|---|---|
| **GitHub** (default) | `@glot-manager/git/github` | none (`fetch`) | no | ✅ | Serverless/edge, the normal path. Commits are GitHub-signed "Verified". |
| **system git** | `@glot-manager/git/system` | none (`git` on PATH) | yes | ❌ (commit mode) | CI, self-hosted, local dev. |
| **your own** | implement `GitBackend` | — | — | optional | isomorphic-git, an in-memory fake for tests. |

Opening a pull request is a host-API operation no git library can perform — the
system backend publishes in `commit` mode; use the GitHub backend for PR mode.

## Path patterns

`pattern` maps `(locale, namespace)` to a file path and back:

| Pattern | Layout | Used by |
|---|---|---|
| `messages/{locale}.json` | one nested file per locale | next-intl, Vue I18n |
| `locales/{locale}/{namespace}.json` | one file per namespace (first key segment) | i18next, react-i18next |
| `src/i18n/{locale}.json` | custom single-file | anything |

With `{namespace}`, the namespace is a key's **first dotted segment**
(`auth.login.title` → `locales/en/auth.json` holding `{ login: { title } }`).

## Serialization guarantees

- 2-space indent, exactly one trailing `\n`, UTF-8, **no BOM**, LF endings.
- Printable non-ASCII stays literal (`Grüezi`, emoji) — never `\uXXXX`.
- Message values are **opaque**: ICU `{count, plural, …}`, `{{vars}}`, and HTML
  tags are never reformatted.
- A missing target locale **omits** the key (your runtime's fallback resolves
  it) — set `serialize: { missingLocale: 'empty' }` for "needs translation"
  markers, or `keyOrder: 'alpha'` for fully canonical files.

Add this to the host repo's `.gitattributes` so Windows checkouts don't rewrite
every line:

```gitattributes
*.json text eol=lf
```

## Security

- Authenticate with a **GitHub App installation token** (short-lived, org-scoped)
  or a fine-grained PAT with `contents: write` (+ `pull_requests: write` for PR
  mode).
- The token is sent only in an in-memory `Authorization` header (GitHub) or
  `http.extraHeader` (system git) — never written to the remote URL, disk, or
  command argv.
- Path traversal, prototype-pollution, and non-string leaves are rejected at the
  boundary; keys are validated by `@glot-manager/core`.

## API

| Export | What it does |
|---|---|
| `createGitTranslationStore(options)` | `{ import, status, publish }` against a backend. |
| `importFromGit(options, opts?)` | One-shot import. |
| `createPublisher(options)` | Just `{ publish, status }`. |
| `wireGitPublish(options)` | `onChange` dirty-set + `handlePublish` for an endpoint. |
| `createGitHubBackend(opts)` · `createSystemGitBackend(opts)` | The two built-in backends. |
| `entriesToFiles` · `filesToEntries` · `planPublish` | The pure serializer/diff, exported for custom flows. |

📖 Full guide: [docs/git.md](https://github.com/jonjoker/glot-manager/blob/main/docs/git.md) ·
License: MIT
