# Git sync (`@glot-manager/git`)

Use your website's git repository of JSON language files as the **source of
truth**. `@glot-manager/git` imports those files into a `TranslationStore`, lets
admins edit in context, and **publishes** the changed keys back as a commit or
pull request — which triggers your normal build and deploy.

> **When to use this.** Reach for git sync when translations should live in your
> repo and ship through your existing CI/CD (review via PR, deploy on merge). If
> you'd rather edits go live instantly from the database with no rebuild, keep
> the database as the source of truth and skip this package — see
> [Stores](./stores.md) and [Architecture](./architecture.md).

- [The model](#the-model)
- [Install](#install)
- [Quickstart](#quickstart)
- [Backends](#backends)
  - [GitHub backend](#github-backend)
  - [System-git backend](#system-git-backend)
  - [Custom backends](#custom-backends)
- [Path patterns and namespaces](#path-patterns-and-namespaces)
- [Operations](#operations)
- [Serialization rules](#serialization-rules)
- [Publishing: commit vs pull request](#publishing-commit-vs-pull-request)
- [Wiring into the server](#wiring-into-the-server)
- [Concurrency, idempotency, and retries](#concurrency-idempotency-and-retries)
- [Security](#security)
- [Testing your integration](#testing-your-integration)
- [FAQ](#faq)

## The model

```
 import (git → store)         edit in context              publish (store → git)
┌───────────────┐   seed    ┌──────────────────┐  saves  ┌──────────────────────┐
│ messages/*.json│ ───────▶ │  TranslationStore │ ◀────── │  admin edits via the  │
│  (the truth)   │          │  (working copy)   │         │  in-context editor    │
└───────────────┘          └──────────────────┘         └──────────────────────┘
        ▲                                                          │
        │                       publish (explicit)                │
        └──────────────  commit / PR  ◀───────────────────────────┘
                         └─▶ CI/CD ─▶ deploy ─▶ live site reads the committed files
```

The live site never reads Glot's store at runtime — it reads the committed JSON
through its normal i18n loader. Glot Manager is the **authoring layer**, and
**publish = git push = deploy**. You trade "instant publish" for review and a
normal deploy pipeline.

## Install

```bash
npm install @glot-manager/git
```

Zero runtime dependencies beyond `@glot-manager/core`. The GitHub backend uses
the global `fetch` (Node ≥ 18); the system backend needs the `git` binary on
`PATH`.

## Quickstart

```ts
import { createGitTranslationStore } from '@glot-manager/git';
import { createGitHubBackend } from '@glot-manager/git/github';

const git = createGitTranslationStore({
  backend: createGitHubBackend({ owner: 'acme', repo: 'website', token: process.env.GLOT_GIT_TOKEN! }),
  pattern: 'messages/{locale}.json',
  locales: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' },
  branch: 'main',
});

// Import the repo into your store.
const { entries, warnings } = await git.import();
for (const entry of entries) await store.upsert(entry);
if (warnings.length) console.warn(warnings);

// Preview what a publish would change (read-only).
const diff = await git.status({ entries: await store.list() });
console.log(diff.summary); // { added, modified, removed, files }

// Publish.
const result = await git.publish({
  entries: await store.list(),
  target: { mode: 'commit', branch: 'main' },
  message: (d) => `chore(i18n): ${d.summary.modified} updated, ${d.summary.added} added`,
});
```

## Backends

A backend implements the `GitBackend` port; the engine does everything else.
Pick one with a subpath import.

| Backend | Import | Runtime dep | Working tree | Opens PRs | Best for |
|---|---|---|---|---|---|
| GitHub (default) | `@glot-manager/git/github` | none (`fetch`) | no | ✅ | Serverless/edge; the normal product path. |
| system git | `@glot-manager/git/system` | none (`git` binary) | yes | ❌ | CI, self-hosted, local dev. |
| custom | implement `GitBackend` | — | — | optional | isomorphic-git, fakes. |

### GitHub backend

Talks to GitHub's Git-Data and Pulls REST APIs over `fetch`. No clone, no
filesystem — it runs in serverless and edge runtimes, and its commits are
auto-signed **Verified** by GitHub.

```ts
import { createGitHubBackend } from '@glot-manager/git/github';

const backend = createGitHubBackend({
  owner: 'acme',
  repo: 'website',
  token: process.env.GLOT_GIT_TOKEN!,
  // baseUrl: 'https://github.example.com/api/v3', // GitHub Enterprise
});
```

**Getting a token.** Prefer a **GitHub App** installation token (short-lived,
org-scoped, minimal permissions) for multi-user servers; a **fine-grained PAT**
is fine for single-user/self-hosted setups. Required permissions:

- `Contents: Read and write` — read and commit the language files.
- `Pull requests: Read and write` — only if you use `mode: 'pull-request'`.

Mint the installation token at publish time (they expire in ~1 hour) and pass it
as `token`. See GitHub's
[authenticating as an App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).

### System-git backend

Drives the system `git` binary via `node:child_process`. Requires `git` on
`PATH` and a writable directory for a working clone. It cannot open pull requests
(no git library can) — publish in `commit` mode, or pair it with the GitHub
backend for the PR step.

```ts
import { createSystemGitBackend } from '@glot-manager/git/system';

const backend = createSystemGitBackend({
  remoteUrl: 'https://github.com/acme/website.git',
  dir: '/var/glot/website',          // persistent working clone
  token: process.env.GLOT_GIT_TOKEN, // optional; sent via an in-memory http.extraHeader
});
```

### Custom backends

Implement the `GitBackend` interface and pass it as `backend`. The split between
`commit` (any git can do it) and the optional `openPullRequest` (host-API only)
lets pure-git backends advertise `capabilities.pullRequests: false` honestly.

```ts
import type { GitBackend } from '@glot-manager/git';

const backend: GitBackend = {
  capabilities: { pullRequests: false, workingTree: false },
  async defaultBranch() { /* … */ },
  async resolveRef({ branch }) { /* → { commit } */ },
  async readFiles(at, paths) { /* → FileChange[] (content: null when missing) */ },
  async listFiles(at, prefix) { /* → string[] */ },
  async commit({ base, branch, message, author, changes }) { /* → { commit, url? } */ },
  // openPullRequest?(…)  // omit when capabilities.pullRequests is false
};
```

`commit` **must** throw `NonFastForwardError` when `base` is no longer the tip of
`branch` — that is the signal the engine retries on.

## Path patterns and namespaces

`pattern` is a template with a required `{locale}` and an optional `{namespace}`:

| Pattern | Layout | Consumed by |
|---|---|---|
| `messages/{locale}.json` | one nested file per locale | next-intl, Vue I18n, custom |
| `locales/{locale}/{namespace}.json` | one file per namespace | i18next, react-i18next |
| `src/i18n/{locale}.json` | custom single-file | anything |

When `{namespace}` is present, the namespace is a key's **first dotted segment**
and the remainder is the in-file key:

```
key  auth.login.title   →   locales/en/auth.json   { "login": { "title": "…" } }
```

Single-segment keys (e.g. `title`) cannot live in a namespaced layout and are
skipped on export with a warning — namespace your keys, or use a single-file
pattern. Glot's `TranslationEntry.namespace` field (everything before the last
segment) is unrelated to the *file* namespace; the file namespace is always the
first segment.

## Operations

`createGitTranslationStore(options)` returns `{ import, status, publish }`.

```ts
interface GitTranslationStoreOptions {
  backend: GitBackend;
  pattern: string;
  locales: LocaleConfig;
  branch?: string;                  // source-of-truth branch; default = backend.defaultBranch()
  serialize?: Partial<SerializeOptions>;
  clock?: Clock;                    // injectable for reproducible commit dates
  author?: { name: string; email: string }; // default glot-manager[bot]
}
```

### `import(options?) → ImportResult`

Reads every file matching `pattern` at `branch` and returns normalized
`entries` (feed them to `store.upsert`) plus `warnings`.

```ts
await git.import({ branch: 'main', sourceLocale: 'en', signal, onProgress });
// → { branch, commit, entries: TranslationEntry[], warnings: string[] }
```

### `status(options) → TranslationDiff`

Read-only. Compares a candidate snapshot against the repo without writing.

```ts
const diff = await git.status({ entries, scope: dirtyKeys, prune: false });
// → { added, modified, removed, unchanged, changedFiles, isClean, summary }
```

### `publish(options) → PublishResult`

Commits the change (or opens/updates a PR). Idempotent: a clean snapshot returns
`{ applied: false }` with no commit.

```ts
interface PublishOptions {
  entries: TranslationEntry[];        // the full working-copy snapshot
  changedKeys?: string[];             // scope the publish (the dirty set)
  target: { mode: 'commit' | 'pull-request'; branch: string; base?; title?; body? };
  message: string | ((diff: TranslationDiff) => string);
  prune?: boolean;                    // remove keys absent from `entries` (default false)
  skipCi?: boolean;                   // append "[skip ci]" (default false)
  dryRun?: boolean;
  retries?: number;                   // non-fast-forward retries (default 3)
  signal?: AbortSignal;
  onProgress?: (event) => void;
}
```

## Serialization rules

Tuned for clean, reviewable diffs:

- **2-space indent**, exactly one trailing `\n`, UTF-8, **no BOM**, LF endings.
- **Never escapes printable non-ASCII** — `Grüezi` and emoji stay literal.
- **Values are opaque** — ICU (`{count, plural, …}`), i18next (`{{var}}`), and
  HTML/rich-text tags are preserved byte-for-byte.
- **Missing target locales are omitted** by default so the runtime's
  `fallbackLng`/`fallbackLocale` resolves them. Options:
  - `missingLocale: 'empty'` writes `""` as a "needs translation" marker (set
    your runtime's `returnEmptyString: false`).
  - `keyOrder: 'alpha'` produces fully canonical, sorted files; the default
    `'source'` preserves order so merges stay minimal.

Add to your **host repo's** `.gitattributes`:

```gitattributes
*.json text eol=lf
```

## Publishing: commit vs pull request

**Commit mode** pushes straight to a branch (e.g. `main`) — simplest, and the
push triggers your deploy.

```ts
target: { mode: 'commit', branch: 'main' }
```

**Pull-request mode** commits to a working branch and opens (or reuses) a PR
against `base`. Use it for protected branches or human review.

```ts
target: { mode: 'pull-request', branch: 'glot/publish', base: 'main', title: 'Translation updates' }
```

The same head branch reuses its open PR instead of opening duplicates. Pair PR
mode with a CI gate that runs `auditEntries` from `@glot-manager/core` (see
[Self-hosting](./self-hosting.md)).

> **CI note.** A push made with a GitHub App token or PAT **does** trigger your
> Actions (the deploy you want). Set `skipCi: true` to append `[skip ci]` for
> trivial regenerated content you don't want to redeploy.

## Wiring into the server

Saves fire `config.onChange(changedKeys)`. Do **not** publish there — that would
commit on every keystroke. Accumulate the dirty keys and publish on an explicit
action with `wireGitPublish`:

```ts
// lib/glot-git.ts
import { wireGitPublish } from '@glot-manager/git';
import { createGitHubBackend } from '@glot-manager/git/github';
import { store, locales } from './glot';

export const publisher = wireGitPublish({
  store,
  backend: createGitHubBackend({ owner: 'acme', repo: 'website', token: process.env.GLOT_GIT_TOKEN! }),
  pattern: 'messages/{locale}.json',
  locales,
  branch: 'main',
  defaultTarget: { mode: 'commit' },
});
```

```ts
// app/api/glot/[...path]/route.ts
import { createGlotHandler, toNextHandler } from '@glot-manager/server';
import { store, locales, translator } from '@/lib/glot';
import { publisher } from '@/lib/glot-git';

const handler = createGlotHandler({
  store, locales, translator,
  onChange: publisher.onChange, // records dirty keys; never publishes
  authorize: async (req) => (await getSession(req))?.role === 'admin',
});
export const { GET, PUT, POST } = toNextHandler(handler);
```

```ts
// app/api/glot/publish/route.ts  (admin-only)
import { publisher } from '@/lib/glot-git';

export async function POST(req: Request) {
  if (!(await isAdmin(req))) return new Response('Forbidden', { status: 403 });
  const result = await publisher.handlePublish();
  return Response.json(result);
}
```

`publisher.hasPendingChanges()` and `publisher.getDirtyKeys()` power a "publish
needed" badge in your admin UI.

## Concurrency, idempotency, and retries

- **Idempotent.** `publish` computes the diff first; if nothing changed it
  returns `{ applied: false }` and never creates an empty commit. Re-running
  converges.
- **Targeted merge.** With `changedKeys` set, only those keys are written onto
  the *current* file content, so a key another writer added concurrently is
  preserved, not clobbered. Correctness comes from recomputing the diff against
  the live tip, not from the dirty set.
- **Non-fast-forward retry.** If the branch advanced since the publish read it,
  the engine re-reads the tip, re-applies the changed keys, and retries (default
  3 times). It never force-pushes.
- **Serialize publishes per repo.** Run one publish at a time per repository
  (an in-process queue, or a distributed lock across workers). The remote ref is
  the ultimate arbiter via push rejection.

## Security

- **Token scope.** Use a GitHub App installation token (preferred) or a
  fine-grained PAT with `contents: write` (+ `pull_requests: write` for PR mode).
  Mint App tokens per publish; never cache them near expiry.
- **No leakage.** The token is sent only in an in-memory `Authorization` header
  (GitHub) or `http.extraHeader` (system git). It is never written to the remote
  URL, to disk, or passed as a command-line argument.
- **Boundary checks.** Locale files are parsed defensively; non-string leaves
  and prototype-polluting key segments are rejected, and the system backend
  refuses to write outside the working clone.

## Testing your integration

The package itself is tested with `node:test` against an in-memory fake backend
(unit) and a local **bare repo as a fake remote** (the system backend
integration tier, skipped when `git` is absent). To test your own wiring,
implement a tiny `GitBackend` fake or point the system backend at a
`git init --bare` repo in a temp dir — no network required.

## FAQ

**Does the live site need Glot's database?** No. With git sync the site reads its
committed JSON files through its normal i18n loader. Glot's store is just the
editing workspace.

**What about keys that exist in the repo but not in my store?** They're reported
in `diff.removed` but left untouched unless you pass `prune: true`. This makes a
scoped publish safe even if your store doesn't hold every key.

**Can I move keys between namespaces?** Yes, but git sees it as a delete + add
(no rename detection) — design your namespace boundaries up front.

**Why not commit on every save?** Commit history should map to deliberate
releases, and per-keystroke commits would spam history and trigger redundant
deploys. Saves stay in the store; you publish when ready.

See also: [Stores](./stores.md) · [Server](./server.md) · [Architecture](./architecture.md) · [Self-hosting](./self-hosting.md)
