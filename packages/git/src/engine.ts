/**
 * The git translation engine: `import` (repo → entries), `status` (read-only
 * diff), and `publish` (entries → one commit or pull request). All I/O goes
 * through the injected {@link GitBackend}; everything else is the pure planning
 * in {@link planPublish}. Publishes are idempotent (a clean snapshot is a
 * no-op), dry-runnable, and retry on a non-fast-forward by re-reading the tip.
 */

import { namespaceOf, type LocaleConfig, type Locale, type TranslationEntry } from '@glot-manager/core';
import { type Clock, systemClock } from './clock.ts';
import { planPublish } from './diff.ts';
import { AbortedError, NotSupportedError, NonFastForwardError, isGitSyncError } from './errors.ts';
import { matchPath, parsePattern, type PathPattern } from './paths.ts';
import { filesToEntries, type SerializeOptions } from './serialize.ts';
import type {
  CommitRef,
  GitBackend,
  GitIdentity,
  ImportResult,
  ProgressEvent,
  PublishResult,
  PublishTarget,
  TranslationDiff,
} from './types.ts';

const DEFAULT_AUTHOR: GitIdentity = {
  name: 'glot-manager[bot]',
  email: 'glot-manager[bot]@users.noreply.github.com',
};

export interface GitTranslationStoreOptions {
  /** The git port. Construct one from `@glot-manager/git/github` or `/system`. */
  backend: GitBackend;
  /** Path template, e.g. `"messages/{locale}.json"` or `"locales/{locale}/{namespace}.json"`. */
  pattern: string;
  /** The locales to read/write. */
  locales: LocaleConfig;
  /** The source-of-truth branch. Defaults to the backend's default branch. */
  branch?: string;
  /** Serialization tuning (indent, key order, missing-locale policy). */
  serialize?: Partial<SerializeOptions>;
  /** Injectable clock for reproducible commit timestamps. */
  clock?: Clock;
  /** Commit author/committer. Defaults to `glot-manager[bot]`. */
  author?: GitIdentity;
}

export interface ImportOptions {
  /** Branch to read. Defaults to the store's configured branch. */
  branch?: string;
  /** Source locale to stamp on imported entries. Defaults to `locales.defaultLocale`. */
  sourceLocale?: Locale;
  /** Cooperative abort: checked between phases (resolve/read/diff/commit), not mid-request. */
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface StatusOptions {
  /** The candidate snapshot to compare against the repo. */
  entries: readonly TranslationEntry[];
  branch?: string;
  /** Restrict the comparison to these keys. */
  scope?: readonly string[] | null;
  /** Account for key removal (keys absent from `entries`). Default `false`. */
  prune?: boolean;
  /** Cooperative abort: checked between phases (resolve/read/diff/commit), not mid-request. */
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface PublishOptions {
  /** The full working-copy snapshot to publish (typically `await store.list()`). */
  entries: readonly TranslationEntry[];
  /** The dirty keys to scope the publish to. Omit to consider every key. */
  changedKeys?: readonly string[];
  /** Where to land the change. */
  target: PublishTarget;
  /**
   * Commit message, or a builder from the computed diff (first line becomes the
   * PR title when `target.title` is omitted).
   */
  message: string | ((diff: TranslationDiff) => string);
  /** Remove keys absent from `entries`. Default `false`. */
  prune?: boolean;
  /** Append `[skip ci]` to the commit message. Default `false`. */
  skipCi?: boolean;
  /** Compute the diff but perform no writes. Default `false`. */
  dryRun?: boolean;
  /** Retries on a non-fast-forward. Default `3`. */
  retries?: number;
  /** Cooperative abort: checked between phases (resolve/read/diff/commit), not mid-request. */
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface GitTranslationStore {
  import(options?: ImportOptions): Promise<ImportResult>;
  status(options: StatusOptions): Promise<TranslationDiff>;
  publish(options: PublishOptions): Promise<PublishResult>;
}

function emit(handler: ((event: ProgressEvent) => void) | undefined, event: ProgressEvent): void {
  handler?.(event);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortedError();
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGitTranslationStore(options: GitTranslationStoreOptions): GitTranslationStore {
  const pattern: PathPattern = parsePattern(options.pattern);
  const { backend, locales } = options;
  const clock = options.clock ?? systemClock;
  const author = options.author ?? DEFAULT_AUTHOR;

  const resolveBranch = async (branch?: string): Promise<string> =>
    branch ?? options.branch ?? (await backend.defaultBranch());

  /** List + read every file under the pattern's prefix at a commit. */
  const readAllFiles = async (at: CommitRef, signal?: AbortSignal) => {
    const paths = (await backend.listFiles(at, pattern.listPrefix)).filter((path) => matchPath(pattern, path));
    throwIfAborted(signal);
    return paths.length === 0 ? [] : backend.readFiles(at, paths);
  };

  const store: GitTranslationStore = {
    async import(importOptions: ImportOptions = {}): Promise<ImportResult> {
      const branch = await resolveBranch(importOptions.branch);
      emit(importOptions.onProgress, { phase: 'resolve', detail: branch });
      const ref = await backend.resolveRef({ branch });
      throwIfAborted(importOptions.signal);

      emit(importOptions.onProgress, { phase: 'read' });
      const files = await readAllFiles(ref, importOptions.signal);
      const sourceLocale = importOptions.sourceLocale ?? locales.defaultLocale;
      const { entries, warnings } = filesToEntries(files, pattern, sourceLocale);

      emit(importOptions.onProgress, { phase: 'done', detail: `${entries.length} keys` });
      return {
        branch,
        commit: ref.commit,
        entries: entries.map((entry) => ({
          key: entry.key,
          namespace: entry.namespace ?? namespaceOf(entry.key),
          values: entry.values,
          sourceLocale: entry.sourceLocale,
        })),
        warnings,
      };
    },

    async status(statusOptions: StatusOptions): Promise<TranslationDiff> {
      const branch = await resolveBranch(statusOptions.branch);
      emit(statusOptions.onProgress, { phase: 'resolve', detail: branch });
      const ref = await backend.resolveRef({ branch });
      throwIfAborted(statusOptions.signal);

      emit(statusOptions.onProgress, { phase: 'read' });
      const files = await readAllFiles(ref, statusOptions.signal);

      emit(statusOptions.onProgress, { phase: 'diff' });
      return planPublish(statusOptions.entries, files, locales, pattern, {
        scope: statusOptions.scope ?? null,
        prune: statusOptions.prune ?? false,
        serialize: options.serialize,
      });
    },

    async publish(publishOptions: PublishOptions): Promise<PublishResult> {
      const { target } = publishOptions;
      if (target.mode === 'pull-request' && !backend.openPullRequest) {
        throw new NotSupportedError(
          'This backend cannot open pull requests; use the GitHub backend, or pair it for the PR step.',
        );
      }
      const baseBranch = await resolveBranch(target.base);
      const maxAttempts = Math.max(1, publishOptions.retries ?? 3);

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        throwIfAborted(publishOptions.signal);

        // Base the change on the head of the target branch, or the base branch
        // if the target branch does not exist yet (first PR publish).
        emit(publishOptions.onProgress, { phase: 'resolve', detail: target.branch });
        const head = await resolveHead(backend, target.branch, baseBranch);

        emit(publishOptions.onProgress, { phase: 'read' });
        const files = await readAllFiles(head, publishOptions.signal);

        emit(publishOptions.onProgress, { phase: 'diff' });
        const diff = planPublish(publishOptions.entries, files, locales, pattern, {
          scope: publishOptions.changedKeys ?? null,
          prune: publishOptions.prune ?? false,
          serialize: options.serialize,
        });

        if (diff.isClean) {
          emit(publishOptions.onProgress, { phase: 'done', detail: 'no changes' });
          return { applied: false, dryRun: Boolean(publishOptions.dryRun), diff, branch: target.branch };
        }
        if (publishOptions.dryRun) {
          emit(publishOptions.onProgress, { phase: 'done', detail: 'dry run' });
          return { applied: false, dryRun: true, diff, branch: target.branch };
        }

        const resolvedMessage =
          typeof publishOptions.message === 'function' ? publishOptions.message(diff) : publishOptions.message;
        const message = publishOptions.skipCi ? `${resolvedMessage}\n\n[skip ci]` : resolvedMessage;

        try {
          emit(publishOptions.onProgress, { phase: 'commit', detail: `${diff.changedFiles.length} files` });
          const committed = await backend.commit({
            base: head,
            branch: target.branch,
            message,
            author: { ...author, date: clock.now() },
            changes: diff.changedFiles,
          });

          const result: PublishResult = {
            applied: true,
            dryRun: false,
            diff,
            branch: target.branch,
            commit: { sha: committed.commit, ...(committed.url ? { url: committed.url } : {}) },
          };

          if (target.mode === 'pull-request') {
            emit(publishOptions.onProgress, { phase: 'pull-request' });
            const pr = await backend.openPullRequest!({
              base: baseBranch,
              head: target.branch,
              title: target.title ?? firstLine(resolvedMessage),
              body: target.body ?? defaultPrBody(diff),
            });
            result.pullRequest = pr;
          }

          emit(publishOptions.onProgress, { phase: 'done' });
          return result;
        } catch (error) {
          if (error instanceof NonFastForwardError && attempt < maxAttempts) {
            await delay(50 * attempt);
            continue; // re-resolve the tip, re-plan onto it, retry
          }
          throw error;
        }
      }

      // Unreachable: each iteration returns, or the final attempt rethrows.
      /* c8 ignore next */
      throw new Error('unreachable: publish retry loop must return or throw');
    },
  };

  return store;
}

async function resolveHead(backend: GitBackend, branch: string, baseBranch: string): Promise<CommitRef> {
  try {
    return await backend.resolveRef({ branch });
  } catch (error) {
    if (isGitSyncError(error) && error.code === 'ref_not_found') {
      return backend.resolveRef({ branch: baseBranch });
    }
    throw error;
  }
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0] ?? message;
}

function defaultPrBody(diff: TranslationDiff): string {
  const { added, modified, removed } = diff.summary;
  return [
    'Automated translation update from Glot Manager.',
    '',
    `- ${added} added, ${modified} modified${removed ? `, ${removed} removed` : ''}`,
    `- ${diff.changedFiles.length} file(s) changed`,
  ].join('\n');
}

/** Convenience: import in one call. */
export function importFromGit(
  options: GitTranslationStoreOptions,
  importOptions?: ImportOptions,
): Promise<ImportResult> {
  return createGitTranslationStore(options).import(importOptions);
}

/** Convenience: a publisher exposing just `publish` and `status`. */
export function createPublisher(
  options: GitTranslationStoreOptions,
): Pick<GitTranslationStore, 'publish' | 'status'> {
  const store = createGitTranslationStore(options);
  return { publish: store.publish, status: store.status };
}
