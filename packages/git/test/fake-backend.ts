/**
 * An in-memory {@link GitBackend} for engine/controller unit tests — mirrors the
 * spirit of core's `MemoryStore`. No git, no FS, no network. Lets tests assert
 * commit/branch behavior and simulate a non-fast-forward race.
 */

import { NonFastForwardError, RefNotFoundError, type CommitRef, type FileChange, type GitBackend } from '../src/index.ts';

interface FakeCommit {
  tree: Map<string, string>;
  parent: string | null;
}

export interface FakeBackend extends GitBackend {
  /** Number of successful commits created. */
  commitCount: number;
  /** Number of pull requests opened (not counting reuse). */
  prCount: number;
  /** Throw a NonFastForwardError on the next N commits (advancing the tip first). */
  injectNonFastForward: number;
  /** Recorded commit messages + author dates (ISO), in order. */
  readonly log: { message: string; date: string }[];
  /** Read a file at the current tip of a branch (test assertion helper). */
  fileAt(branch: string, path: string): string | undefined;
  branchTip(branch: string): string | undefined;
}

export function createFakeBackend(seed: Record<string, Record<string, string>> = {}): FakeBackend {
  const commits = new Map<string, FakeCommit>();
  const branches = new Map<string, string>();
  let counter = 0;
  const nextSha = (): string => `c${(++counter).toString().padStart(4, '0')}`;

  for (const [branch, files] of Object.entries(seed)) {
    const sha = nextSha();
    commits.set(sha, { tree: new Map(Object.entries(files)), parent: null });
    branches.set(branch, sha);
  }

  const state = {
    commitCount: 0,
    prCount: 0,
    injectNonFastForward: 0,
  };

  const pulls = new Map<string, { number: number; url: string }>();
  let prNumber = 0;
  const log: { message: string; date: string }[] = [];

  const backend: FakeBackend = {
    capabilities: { pullRequests: true, workingTree: false },
    get commitCount() {
      return state.commitCount;
    },
    get prCount() {
      return state.prCount;
    },
    get injectNonFastForward() {
      return state.injectNonFastForward;
    },
    set injectNonFastForward(value: number) {
      state.injectNonFastForward = value;
    },
    log,

    async defaultBranch() {
      return 'main';
    },

    async resolveRef({ branch }): Promise<CommitRef> {
      const sha = branches.get(branch);
      if (!sha) throw new RefNotFoundError(branch);
      return { commit: sha };
    },

    async readFiles(at, paths): Promise<FileChange[]> {
      const tree = commits.get(at.commit)?.tree ?? new Map<string, string>();
      return paths.map((path) => ({ path, content: tree.has(path) ? tree.get(path)! : null }));
    },

    async listFiles(at, prefix): Promise<string[]> {
      const tree = commits.get(at.commit)?.tree ?? new Map<string, string>();
      const normalized = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
      return [...tree.keys()].filter((path) => path.startsWith(normalized));
    },

    async commit({ base, branch, message, author, changes }) {
      if (state.injectNonFastForward > 0) {
        state.injectNonFastForward -= 1;
        // Simulate another writer advancing the branch since `base` was read.
        const tipSha = branches.get(branch) ?? base.commit;
        const tip = commits.get(tipSha);
        const advanced = nextSha();
        commits.set(advanced, { tree: new Map(tip?.tree ?? []), parent: tipSha });
        branches.set(branch, advanced);
        throw new NonFastForwardError(branch, base.commit);
      }

      const tipSha = branches.get(branch);
      if (tipSha !== undefined && tipSha !== base.commit) throw new NonFastForwardError(branch, base.commit);

      const baseTree = commits.get(base.commit)?.tree ?? new Map<string, string>();
      const tree = new Map(baseTree);
      for (const change of changes) {
        if (change.content === null) tree.delete(change.path);
        else tree.set(change.path, change.content);
      }
      const sha = nextSha();
      commits.set(sha, { tree, parent: base.commit });
      branches.set(branch, sha);
      state.commitCount += 1;
      log.push({ message, date: author.date.toISOString() });
      return { commit: sha, url: `https://fake.test/commit/${sha}` };
    },

    async openPullRequest({ head, base: _base, title: _title, body: _body }) {
      const existing = pulls.get(head);
      if (existing) return { ...existing, reused: true };
      const created = { number: ++prNumber, url: `https://fake.test/pull/${prNumber}` };
      pulls.set(head, created);
      state.prCount += 1;
      return { ...created, reused: false };
    },

    fileAt(branch, path) {
      const sha = branches.get(branch);
      return sha ? commits.get(sha)?.tree.get(path) : undefined;
    },
    branchTip(branch) {
      return branches.get(branch);
    },
  };

  return backend;
}
