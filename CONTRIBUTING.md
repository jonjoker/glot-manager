# Contributing to Glot Manager

Thanks for helping make Glot Manager better! This is an npm-workspaces monorepo.

## Prerequisites

- **Node ≥ 22.18** (the test runner executes TypeScript source directly via
  type-stripping). The published packages target Node ≥ 18.
- npm 9+ (ships with Node).

## Setup

```bash
git clone https://github.com/jonjoker/glot-manager.git
cd glot
npm install
```

## Common commands

```bash
npm test            # run every package's tests
npm run typecheck   # type-check every package
npm run build       # build every package (tsup → dual ESM+CJS + d.ts)
npm run lint        # eslint
npm run format      # prettier --write
```

Per-package, e.g.:

```bash
npm test -w @glot/core
npm run build -w @glot/react
```

### How tests run

- The logic packages (`core`, `server`, `openai`, `anthropic`, `postgres`) use
  the built-in Node test runner on `.ts` files — **no build step needed**.
  Cross-package imports resolve to source via the `glot-dev` export condition
  (`node --conditions=glot-dev`).
- `@glot/react` uses Vitest + jsdom.

Provider tests are hermetic — they inject a fake client and never hit a network.

## Code style

- TypeScript with `strict` + `noUncheckedIndexedAccess`. Use **erasable syntax
  only** (no `enum`/`namespace`) so Node can run the source directly.
- Prefer the existing patterns in each package; match comment density and naming.
- Public API gets JSDoc.

## Changesets

User-facing changes need a changeset:

```bash
npm run changeset
```

Pick the bump and write a one-line summary; commit the generated file with your
PR. All `@glot/*` packages are versioned together.

## Pull requests

1. Branch from `main`.
2. Add tests for new behavior.
3. Ensure `npm run lint && npm run typecheck && npm test && npm run build` pass.
4. Add a changeset.
5. Open the PR — CI runs the matrix (Node 22 & 24).

## Reporting bugs / requesting features

Use the issue templates. For security issues, see [SECURITY.md](./SECURITY.md) —
please don't open a public issue.
