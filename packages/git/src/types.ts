/**
 * Public data types and the {@link GitBackend} port for `@glot-manager/git`.
 *
 * The port is the single seam between the (zero-dependency) engine and the
 * outside world. It deliberately splits "change the repo" — {@link
 * GitBackend.commit}, which any git implementation can do — from "open a pull
 * request" — {@link GitBackend.openPullRequest}, which is a host-API operation
 * (GitHub/GitLab) that no git library can perform. Backends advertise what they
 * support via {@link GitBackend.capabilities}.
 */

import type { TranslationEntry } from '@glot-manager/core';

/** A single file to write (`content` a string) or delete (`content: null`). */
export interface FileChange {
  /** Repo-relative POSIX path, e.g. `"locales/de/auth.json"`. */
  path: string;
  /** New UTF-8 contents, or `null` to delete the file. */
  content: string | null;
}

/** Commit author/committer identity. */
export interface GitIdentity {
  name: string;
  email: string;
}

/** A resolved commit on the remote. */
export interface CommitRef {
  commit: string;
}

/** Where a publish lands. */
export interface PublishTarget {
  /** `"commit"` pushes straight to `branch`; `"pull-request"` opens/updates a PR. */
  mode: 'commit' | 'pull-request';
  /** The working/target branch (deterministic, e.g. `"main"` or `"glot/publish"`). */
  branch: string;
  /** Base branch a pull request merges into. Defaults to the backend's default branch. */
  base?: string;
  /** Pull-request title (PR mode only). */
  title?: string;
  /** Pull-request body (PR mode only). */
  body?: string;
}

/** Coarse phases emitted via `onProgress`. */
export type ProgressPhase = 'resolve' | 'read' | 'diff' | 'commit' | 'pull-request' | 'done';

export interface ProgressEvent {
  phase: ProgressPhase;
  /** Human-readable detail, safe to log (never contains secrets). */
  detail?: string;
}

/**
 * The pluggable git port. Implementations live behind subpath exports
 * (`@glot-manager/git/github`, `@glot-manager/git/system`) or you can bring your
 * own (isomorphic-git, an in-memory fake for tests).
 */
export interface GitBackend {
  /** What this backend can do. The engine checks this before a PR publish. */
  readonly capabilities: {
    /** `true` if {@link openPullRequest} is implemented. */
    pullRequests: boolean;
    /** `true` if the backend materializes a working tree on disk. */
    workingTree: boolean;
  };

  /** The default branch of the repo (used as a PR base when none is given). */
  defaultBranch(): Promise<string>;

  /** Resolve a branch to its current head commit. Throws if the branch is missing. */
  resolveRef(ref: { branch: string }): Promise<CommitRef>;

  /**
   * Read files at a commit. Returns one {@link FileChange} per requested path,
   * in the same order; a missing file comes back with `content: null`.
   */
  readFiles(at: CommitRef, paths: string[]): Promise<FileChange[]>;

  /**
   * List repo-relative paths of blobs under `prefix` at a commit (for import
   * discovery). `prefix` is a directory path without a trailing slash.
   */
  listFiles(at: CommitRef, prefix: string): Promise<string[]>;

  /**
   * Apply `changes` as exactly one commit on top of `base`, advancing `branch`
   * (creating it if absent). Must throw {@link NonFastForwardError} when `base`
   * is no longer the tip of `branch`. Returns the new commit.
   */
  commit(input: {
    base: CommitRef;
    branch: string;
    message: string;
    author: GitIdentity & { date: Date };
    changes: FileChange[];
  }): Promise<{ commit: string; url?: string }>;

  /**
   * Open a pull request for `head` → `base`, or reuse the open one for `head`.
   * Only present when `capabilities.pullRequests` is `true`.
   */
  openPullRequest?(input: {
    base: string;
    head: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string; reused: boolean }>;
}

/** A read-only, structured comparison of a candidate snapshot against the repo. */
export interface TranslationDiff {
  /** Keys present in the candidate but not in the repo. */
  added: string[];
  /** Keys whose value changed in at least one locale. */
  modified: string[];
  /** Keys in the repo but absent from the candidate (only acted on when `prune`). */
  removed: string[];
  /**
   * Keys whose candidate-carried locale values match the repo (per-locale string
   * comparison). Does not imply the serialized file bytes are identical — that
   * is what {@link isClean} / {@link changedFiles} report.
   */
  unchanged: string[];
  /** The exact files that would be written/deleted to apply the candidate. */
  changedFiles: FileChange[];
  /** `true` when nothing would change. */
  isClean: boolean;
  summary: { added: number; modified: number; removed: number; files: number };
}

export interface ImportResult {
  /** The branch that was read. */
  branch: string;
  /** The commit the files were read at. */
  commit: string;
  /** Normalized entries, ready to feed `store.upsert`. */
  entries: TranslationEntry[];
  /** Non-fatal issues (skipped non-string leaves, unparseable files, …). */
  warnings: string[];
}

export interface PublishResult {
  /** `false` on a no-op (nothing changed) or a dry run. */
  applied: boolean;
  dryRun: boolean;
  /** The diff that drove (or would have driven) the publish. */
  diff: TranslationDiff;
  /** The branch that was published to. */
  branch: string;
  commit?: { sha: string; url?: string };
  pullRequest?: { number: number; url: string; reused: boolean };
}
