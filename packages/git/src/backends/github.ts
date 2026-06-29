/**
 * `@glot-manager/git/github` — a {@link GitBackend} backed by GitHub's Git-Data
 * and Pulls REST APIs over the global `fetch`.
 *
 * Zero runtime dependencies and no working tree, so it runs in serverless and
 * edge runtimes. It is the only backend that can open pull requests, and its
 * commits are auto-signed "Verified" by GitHub. Authenticate with a GitHub App
 * installation token (recommended) or a fine-grained PAT with `contents: write`
 * (and `pull_requests: write` for PR mode). The token is sent only in an
 * in-memory `Authorization` header — never written to disk or a remote URL.
 */

import { mapLimit } from '../concurrency.ts';
import { GitAuthError, GitSyncError, NonFastForwardError, RateLimitedError, RefNotFoundError } from '../errors.ts';
import type { CommitRef, FileChange, GitBackend, GitIdentity } from '../types.ts';

/** Max concurrent content requests in readFiles, to stay under rate limits. */
const READ_CONCURRENCY = 8;

export interface GitHubBackendOptions {
  owner: string;
  repo: string;
  /** GitHub App installation token or a fine-grained PAT. */
  token: string;
  /** Override `fetch` (for tests or a custom client). Defaults to the global. */
  fetch?: typeof fetch;
  /** API base URL. Defaults to `https://api.github.com` (set for GitHub Enterprise). */
  baseUrl?: string;
  /** `X-GitHub-Api-Version` header. Defaults to `2022-11-28`. */
  apiVersion?: string;
  /** `User-Agent` header. Defaults to `glot-manager-git`. */
  userAgent?: string;
}

interface RequestResult {
  status: number;
  ok: boolean;
  data: unknown;
}

const MODE_FILE = '100644';

function base64ToUtf8(input: string): string {
  const binary = atob(input.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createGitHubBackend(options: GitHubBackendOptions): GitBackend {
  if (!options.owner || !options.repo) throw new GitSyncError('GitHub backend requires { owner, repo }', { code: 'invalid_config', status: 500 });
  if (!options.token) throw new GitAuthError('GitHub backend requires a token');

  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new GitSyncError('No global fetch available; pass options.fetch', { code: 'invalid_config', status: 500 });
  }
  const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const repoBase = `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;

  const request = async (method: string, path: string, body?: unknown): Promise<RequestResult> => {
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': options.apiVersion ?? '2022-11-28',
        'user-agent': options.userAgent ?? 'glot-manager-git',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, ok: response.ok, data };
  };

  const messageOf = (data: unknown, fallback: string): string => {
    if (data && typeof data === 'object' && 'message' in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    return fallback;
  };

  const ensureOk = (result: RequestResult, context: string): unknown => {
    if (result.ok) return result.data;
    const message = messageOf(result.data, `HTTP ${result.status}`);
    if (result.status === 401) throw new GitAuthError(`GitHub ${context} failed: ${message}`);
    if (result.status === 403) {
      // GitHub uses 403 for both permission denials and rate/abuse limits.
      if (/rate limit|secondary rate|abuse|too many requests/i.test(message)) {
        throw new RateLimitedError(`GitHub ${context} rate-limited: ${message}`);
      }
      throw new GitAuthError(`GitHub ${context} failed: ${message}`);
    }
    if (result.status === 429) throw new RateLimitedError(`GitHub ${context} rate-limited: ${message}`);
    throw new GitSyncError(`GitHub ${context} failed (${result.status}): ${message}`, {
      code: 'backend_error',
      status: result.status,
    });
  };

  const getTreeShaOfCommit = async (commit: string): Promise<string> => {
    const data = ensureOk(await request('GET', `${repoBase}/git/commits/${commit}`), 'read commit') as {
      tree?: { sha?: string };
    };
    const sha = data.tree?.sha;
    if (!sha) throw new GitSyncError(`Commit ${commit} has no tree`, { code: 'backend_error', status: 502 });
    return sha;
  };

  const updateOrCreateRef = async (branch: string, sha: string, base: string): Promise<void> => {
    const refPath = `${repoBase}/git/refs/heads/${branch}`;
    const patched = await request('PATCH', refPath, { sha, force: false });
    if (patched.ok) return;
    if (patched.status === 422) {
      const existing = await request('GET', `${repoBase}/git/ref/heads/${branch}`);
      if (existing.status === 404) {
        // The ref doesn't exist yet — create it. A concurrent writer may win the
        // race, surfacing 422 "Reference already exists" → treat as non-ff so the
        // engine retries against the now-existing tip.
        const created = await request('POST', `${repoBase}/git/refs`, { ref: `refs/heads/${branch}`, sha });
        if (created.ok) return;
        if (created.status === 422) throw new NonFastForwardError(branch, base);
        ensureOk(created, 'create ref');
        return;
      }
      // The ref exists: a real non-fast-forward, or some other validation error.
      if (/not a fast forward|fast-forward/i.test(messageOf(patched.data, ''))) {
        throw new NonFastForwardError(branch, base);
      }
      ensureOk(patched, 'update ref'); // surface non-ff-unrelated 422s as backend_error
      return;
    }
    ensureOk(patched, 'update ref');
  };

  const backend: GitBackend = {
    capabilities: { pullRequests: true, workingTree: false },

    async defaultBranch(): Promise<string> {
      const data = ensureOk(await request('GET', repoBase), 'read repo') as { default_branch?: string };
      return data.default_branch ?? 'main';
    },

    async resolveRef({ branch }): Promise<CommitRef> {
      const result = await request('GET', `${repoBase}/git/ref/heads/${branch}`);
      if (result.status === 404) throw new RefNotFoundError(branch);
      const data = ensureOk(result, 'resolve ref') as { object?: { sha?: string } };
      const sha = data.object?.sha;
      if (!sha) throw new RefNotFoundError(branch);
      return { commit: sha };
    },

    async readFiles(at, paths): Promise<FileChange[]> {
      return mapLimit(paths, READ_CONCURRENCY, async (path): Promise<FileChange> => {
        const result = await request('GET', `${repoBase}/contents/${encodePath(path)}?ref=${at.commit}`);
        if (result.status === 404) return { path, content: null };
        const data = ensureOk(result, `read ${path}`) as { content?: string; encoding?: string; sha?: string };
        // Inline base64 (the normal case; `base64ToUtf8('')` is `''`).
        if (data.encoding === 'base64' && typeof data.content === 'string') {
          return { path, content: base64ToUtf8(data.content) };
        }
        // Large files (>1MB) come back with encoding "none" and no inline content.
        if (data.sha) {
          const blob = ensureOk(await request('GET', `${repoBase}/git/blobs/${data.sha}`), `read blob ${path}`) as {
            content?: string;
            encoding?: string;
          };
          return {
            path,
            content: typeof blob.content === 'string' && blob.encoding === 'base64' ? base64ToUtf8(blob.content) : '',
          };
        }
        return { path, content: '' };
      });
    },

    async listFiles(at, prefix): Promise<string[]> {
      const treeSha = await getTreeShaOfCommit(at.commit);
      const data = ensureOk(await request('GET', `${repoBase}/git/trees/${treeSha}?recursive=1`), 'list tree') as {
        tree?: { path?: string; type?: string }[];
        truncated?: boolean;
      };
      // A truncated tree (>~100k entries) would silently drop files and corrupt a
      // diff/publish — fail loudly rather than operate on a partial listing.
      if (data.truncated) {
        throw new GitSyncError(
          `GitHub tree for ${at.commit} is truncated; the repo is too large to list recursively in one request`,
          { code: 'backend_error', status: 502 },
        );
      }
      const normalizedPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
      return (data.tree ?? [])
        .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string' && entry.path.startsWith(normalizedPrefix))
        .map((entry) => entry.path as string);
    },

    async commit({ base, branch, message, author, changes }): Promise<{ commit: string; url?: string }> {
      const baseTree = await getTreeShaOfCommit(base.commit);
      const treeEntries = changes.map((change) =>
        change.content === null
          ? { path: change.path, mode: MODE_FILE, type: 'blob' as const, sha: null }
          : { path: change.path, mode: MODE_FILE, type: 'blob' as const, content: change.content },
      );
      const tree = ensureOk(
        await request('POST', `${repoBase}/git/trees`, { base_tree: baseTree, tree: treeEntries }),
        'create tree',
      ) as { sha?: string };
      if (!tree.sha) throw new GitSyncError('Tree creation returned no sha', { code: 'backend_error', status: 502 });

      const identity = toGitHubIdentity(author);
      const commit = ensureOk(
        await request('POST', `${repoBase}/git/commits`, {
          message,
          tree: tree.sha,
          parents: [base.commit],
          author: identity,
          committer: identity,
        }),
        'create commit',
      ) as { sha?: string; html_url?: string };
      if (!commit.sha) throw new GitSyncError('Commit creation returned no sha', { code: 'backend_error', status: 502 });

      await updateOrCreateRef(branch, commit.sha, base.commit);
      return { commit: commit.sha, ...(commit.html_url ? { url: commit.html_url } : {}) };
    },

    async openPullRequest({ base, head, title, body }): Promise<{ number: number; url: string; reused: boolean }> {
      const existing = ensureOk(
        await request('GET', `${repoBase}/pulls?state=open&head=${encodeURIComponent(`${options.owner}:${head}`)}&base=${encodeURIComponent(base)}`),
        'list pull requests',
      ) as { number?: number; html_url?: string }[];
      if (Array.isArray(existing) && existing[0]?.number) {
        return { number: existing[0].number, url: existing[0].html_url ?? '', reused: true };
      }
      const created = ensureOk(
        await request('POST', `${repoBase}/pulls`, { title, head, base, body }),
        'open pull request',
      ) as { number?: number; html_url?: string };
      if (!created.number) throw new GitSyncError('Pull request creation returned no number', { code: 'backend_error', status: 502 });
      return { number: created.number, url: created.html_url ?? '', reused: false };
    },
  };

  return backend;
}

function toGitHubIdentity(author: GitIdentity & { date: Date }): { name: string; email: string; date: string } {
  return { name: author.name, email: author.email, date: author.date.toISOString() };
}
