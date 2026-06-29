/**
 * `@glot-manager/git/system` — a {@link GitBackend} driven by the system `git`
 * binary via `node:child_process`. Zero npm dependencies, but requires `git` on
 * PATH and a writable working clone, so it is for Node servers, CI, and
 * self-hosted setups (not edge runtimes).
 *
 * It cannot open pull requests (no git binary can) — pair it with the GitHub
 * backend for the PR step, or publish in `commit` mode. The auth token is
 * injected per network command via an in-memory `http.extraHeader` passed
 * through `GIT_CONFIG_*` environment variables — never written to the remote
 * URL, to disk, or onto the command line (where `ps` could read it).
 */

import { execFile, type ExecFileException } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { mapLimit } from '../concurrency.ts';
import { GitSyncError, NonFastForwardError, RefNotFoundError } from '../errors.ts';
import type { CommitRef, FileChange, GitBackend } from '../types.ts';

export interface SystemGitExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type SystemGitExec = (
  args: string[],
  options: { cwd?: string; env?: Record<string, string> },
) => Promise<SystemGitExecResult>;

export interface SystemGitBackendOptions {
  /** Remote URL (https or a local path for tests). The token is never embedded here. */
  remoteUrl: string;
  /** Working clone directory. Created on first use. */
  dir: string;
  /** Optional HTTPS token, injected via an in-memory `http.extraHeader`. */
  token?: string;
  /** Override how `git` is executed (for tests). Defaults to `execFile('git', …)`. */
  exec?: SystemGitExec;
}

const READ_CONCURRENCY = 8;

const defaultExec: SystemGitExec = (args, { cwd, env }) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        // Pin a stable, non-interactive locale so error/status text we match on
        // (non-fast-forward, "already exists", …) is never localized.
        env: { ...process.env, ...env, LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0' },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
      (error: ExecFileException | null, stdout, stderr) => {
        if (error && typeof error.code === 'number') resolve({ stdout, stderr, code: error.code });
        else if (error) reject(new GitSyncError(`Failed to run git: ${error.message}`, { code: 'backend_error', cause: error }));
        else resolve({ stdout, stderr, code: 0 });
      },
    );
  });

const pathExists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

export function createSystemGitBackend(options: SystemGitBackendOptions): GitBackend {
  const exec = options.exec ?? defaultExec;
  const dir = resolvePath(options.dir);
  let cloned = false;

  /** Env that carries the auth header to network subcommands (config-via-env, not argv). */
  const authEnv = (): Record<string, string> => {
    if (!options.token || !/^https?:/i.test(options.remoteUrl)) return {};
    const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${options.token}`).toString('base64')}`;
    return { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: header };
  };

  const run = (args: string[], env?: Record<string, string>): Promise<SystemGitExecResult> =>
    exec(args, { cwd: dir, ...(env ? { env } : {}) });

  const mustRun = async (args: string[], context: string, env?: Record<string, string>): Promise<string> => {
    const result = await run(args, env);
    if (result.code !== 0) {
      throw new GitSyncError(`git ${context} failed: ${result.stderr.trim() || `exit ${result.code}`}`, {
        code: 'backend_error',
      });
    }
    return result.stdout;
  };

  const ensureClone = async (): Promise<void> => {
    if (cloned) return;
    if (await pathExists(join(dir, '.git'))) {
      const probe = await run(['rev-parse', '--is-inside-work-tree']);
      if (probe.code === 0 && probe.stdout.trim() === 'true') {
        cloned = true;
        return;
      }
      await rm(dir, { recursive: true, force: true }); // corrupt/partial clone → start fresh
    }
    await mkdir(dirname(dir), { recursive: true });
    const result = await exec(['clone', '--no-tags', options.remoteUrl, dir], { cwd: dirname(dir), env: authEnv() });
    if (result.code !== 0) {
      throw new GitSyncError(`git clone failed: ${result.stderr.trim() || `exit ${result.code}`}`, { code: 'backend_error' });
    }
    cloned = true;
  };

  const backend: GitBackend = {
    capabilities: { pullRequests: false, workingTree: true },

    async defaultBranch(): Promise<string> {
      await ensureClone();
      const out = await mustRun(['ls-remote', '--symref', 'origin', 'HEAD'], 'ls-remote', authEnv());
      const match = /ref:\s+refs\/heads\/(\S+)\s+HEAD/.exec(out);
      return match?.[1] ?? 'main';
    },

    async resolveRef({ branch }): Promise<CommitRef> {
      await ensureClone();
      // Fetch into a private namespaced ref and read that — never the shared
      // FETCH_HEAD, which a concurrent fetch could overwrite.
      const localRef = `refs/glot-manager/fetch/${branch}`;
      const fetched = await run(['fetch', '--no-tags', '--force', 'origin', `+refs/heads/${branch}:${localRef}`], authEnv());
      if (fetched.code !== 0) {
        if (/couldn't find remote ref|no such ref|not found/i.test(fetched.stderr)) throw new RefNotFoundError(branch);
        throw new GitSyncError(`git fetch ${branch} failed: ${fetched.stderr.trim()}`, { code: 'backend_error' });
      }
      const sha = (await mustRun(['rev-parse', localRef], 'rev-parse')).trim();
      return { commit: sha };
    },

    async readFiles(at, paths): Promise<FileChange[]> {
      await ensureClone();
      return mapLimit(paths, READ_CONCURRENCY, async (path): Promise<FileChange> => {
        const result = await run(['show', `${at.commit}:${path}`]);
        if (result.code !== 0) return { path, content: null };
        return { path, content: result.stdout };
      });
    },

    async listFiles(at, prefix): Promise<string[]> {
      await ensureClone();
      const args = ['ls-tree', '-r', '--name-only', at.commit];
      if (prefix) args.push('--', prefix);
      const out = await mustRun(args, 'ls-tree'); // throw on failure rather than masquerade as empty
      return out.split('\n').map((line) => line.trim()).filter(Boolean);
    },

    async commit({ base, branch, message, author, changes }): Promise<{ commit: string }> {
      await ensureClone();
      await mustRun(['checkout', '--force', '-B', branch, base.commit], 'checkout');

      for (const change of changes) {
        const target = resolvePath(join(dir, change.path));
        const rel = relative(dir, target);
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
          throw new GitSyncError(`Refusing to write outside the repo: ${change.path}`, { code: 'invalid_config', status: 400 });
        }
        if (change.content === null) {
          await rm(target, { force: true });
        } else {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, change.content, 'utf-8');
        }
      }

      await mustRun(['add', '-A', '--', ...changes.map((change) => change.path)], 'add');
      const staged = await run(['diff', '--cached', '--quiet']);
      if (staged.code === 0) return { commit: base.commit }; // nothing staged → no-op

      const isoDate = author.date.toISOString();
      const env: Record<string, string> = {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_AUTHOR_DATE: isoDate,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
        GIT_COMMITTER_DATE: isoDate,
      };
      await mustRun(['-c', 'core.autocrlf=false', 'commit', '--no-gpg-sign', '-m', message], 'commit', env);
      const sha = (await mustRun(['rev-parse', 'HEAD'], 'rev-parse')).trim();

      const pushed = await run(['push', 'origin', `${branch}:${branch}`], authEnv());
      if (pushed.code !== 0) {
        if (/non-fast-forward|\[rejected\]|failed to push|fetch first/i.test(pushed.stderr)) {
          throw new NonFastForwardError(branch, base.commit);
        }
        throw new GitSyncError(`git push failed: ${pushed.stderr.trim()}`, { code: 'backend_error' });
      }
      return { commit: sha };
    },
  };

  return backend;
}
