/**
 * `@glot-manager/git` — git sync for Glot Manager.
 *
 * Import translation files from a website's git repo into a `TranslationStore`,
 * let admins edit in context, then publish the changed keys back as a commit or
 * pull request. The repo stays the source of truth; the store is a working copy.
 *
 * This entry point is the zero-dependency engine and is safe to import anywhere
 * (including edge runtimes). Construct a git backend from a subpath export:
 *   - `@glot-manager/git/github` — GitHub Git-Data API over `fetch` (default; opens PRs)
 *   - `@glot-manager/git/system` — the system `git` binary (Node only; CI/self-hosted)
 *   - or implement {@link GitBackend} yourself (isomorphic-git, an in-memory fake).
 */

export const VERSION = '0.1.0';

export * from './errors.ts';
export * from './clock.ts';
export * from './types.ts';
export * from './paths.ts';
export * from './serialize.ts';
export * from './diff.ts';
export * from './engine.ts';
export * from './controller.ts';
