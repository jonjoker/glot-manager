/**
 * A minimal in-memory GitHub Git-Data + Pulls API simulator exposed as a fake
 * `fetch`, for testing the GitHub backend offline. It models exactly the
 * endpoints the backend touches: ref read/update/create, commit/tree reads,
 * contents reads, blob/tree/commit creation, and pulls list/create.
 */

interface Recorded {
  method: string;
  path: string;
  search: string;
  authorization?: string;
  body?: unknown;
}

export interface FakeGitHub {
  fetch: typeof fetch;
  calls: Recorded[];
  /** Force the next ref update to report a non-fast-forward. */
  forceNonFastForward: boolean;
  /** Make recursive tree listings report `truncated: true`. */
  forceTruncated: boolean;
  /** Make ref creation (POST /git/refs) 422 with "Reference already exists". */
  forceRefAlreadyExists: boolean;
  branchSha(branch: string): string | undefined;
}

export function createFakeGitHub(
  owner: string,
  repo: string,
  seed: Record<string, Record<string, string>> = {},
): FakeGitHub {
  const branches = new Map<string, string>();
  const commitFiles = new Map<string, Map<string, string>>();
  const commitParent = new Map<string, string | null>();
  const trees = new Map<string, Map<string, string>>();
  const pulls: { number: number; head: string; base: string; html_url: string }[] = [];
  const calls: Recorded[] = [];
  const state = { forceNonFastForward: false, forceTruncated: false, forceRefAlreadyExists: false };
  let counter = 0;
  const id = (prefix: string): string => `${prefix}-${(++counter).toString().padStart(3, '0')}`;

  for (const [branch, files] of Object.entries(seed)) {
    const sha = id('commit');
    commitFiles.set(sha, new Map(Object.entries(files)));
    commitParent.set(sha, null);
    branches.set(branch, sha);
  }

  const prefix = `/repos/${owner}/${repo}`;
  const json = (data: unknown, status = 200): Response =>
    new Response(status === 204 ? '' : JSON.stringify(data), { status });

  const fakeFetch = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const rest = url.pathname.slice(prefix.length);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, path: rest, search: url.search, authorization: headers.authorization, body });

    // GET /repos/{o}/{r}
    if (method === 'GET' && rest === '') return json({ default_branch: 'main' });

    // Ref existence/read: GET /git/ref/heads/{branch}
    if (method === 'GET' && rest.startsWith('/git/ref/heads/')) {
      const branch = rest.slice('/git/ref/heads/'.length);
      const sha = branches.get(branch);
      return sha ? json({ object: { sha } }) : json({ message: 'Not Found' }, 404);
    }

    // GET /git/commits/{sha}
    if (method === 'GET' && rest.startsWith('/git/commits/')) {
      const sha = rest.slice('/git/commits/'.length);
      trees.set(`tree-${sha}`, commitFiles.get(sha) ?? new Map());
      return json({ tree: { sha: `tree-${sha}` } });
    }

    // GET /git/trees/{treeSha}?recursive=1
    if (method === 'GET' && rest.startsWith('/git/trees/')) {
      const treeSha = rest.slice('/git/trees/'.length);
      const files = trees.get(treeSha) ?? new Map();
      return json({ tree: [...files.keys()].map((path) => ({ path, type: 'blob' })), truncated: state.forceTruncated });
    }

    // GET /contents/{path}?ref={sha}
    if (method === 'GET' && rest.startsWith('/contents/')) {
      const path = decodeURIComponent(rest.slice('/contents/'.length));
      const ref = url.searchParams.get('ref') ?? '';
      const content = commitFiles.get(ref)?.get(path);
      if (content === undefined) return json({ message: 'Not Found' }, 404);
      return json({ content: Buffer.from(content, 'utf-8').toString('base64'), encoding: 'base64', sha: `blob-${path}` });
    }

    // POST /git/trees  { base_tree, tree:[{path, content|sha:null}] }
    if (method === 'POST' && rest === '/git/trees') {
      const baseSha = (body.base_tree as string).replace(/^tree-/, '');
      const files = new Map(commitFiles.get(baseSha) ?? new Map<string, string>());
      for (const entry of body.tree as { path: string; content?: string; sha?: string | null }[]) {
        if (entry.sha === null) files.delete(entry.path);
        else if (typeof entry.content === 'string') files.set(entry.path, entry.content);
      }
      const treeSha = id('tree');
      trees.set(treeSha, files);
      return json({ sha: treeSha });
    }

    // POST /git/commits { tree, parents }
    if (method === 'POST' && rest === '/git/commits') {
      const files = trees.get(body.tree as string) ?? new Map();
      const sha = id('commit');
      commitFiles.set(sha, new Map(files));
      commitParent.set(sha, (body.parents as string[])[0] ?? null);
      return json({ sha, html_url: `https://github.test/${owner}/${repo}/commit/${sha}` });
    }

    // PATCH /git/refs/heads/{branch} { sha, force }
    if (method === 'PATCH' && rest.startsWith('/git/refs/heads/')) {
      const branch = rest.slice('/git/refs/heads/'.length);
      if (!branches.has(branch)) return json({ message: 'Reference does not exist' }, 422);
      if (state.forceNonFastForward) {
        state.forceNonFastForward = false;
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      const newSha = body.sha as string;
      if (commitParent.get(newSha) !== branches.get(branch)) {
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      branches.set(branch, newSha);
      return json({ object: { sha: newSha } });
    }

    // POST /git/refs { ref, sha }
    if (method === 'POST' && rest === '/git/refs') {
      if (state.forceRefAlreadyExists) return json({ message: 'Reference already exists' }, 422);
      const branch = (body.ref as string).replace('refs/heads/', '');
      branches.set(branch, body.sha as string);
      return json({ object: { sha: body.sha } });
    }

    // GET /pulls?head=...&base=...
    if (method === 'GET' && rest === '/pulls') {
      const head = url.searchParams.get('head') ?? '';
      const matches = pulls.filter((pull) => `${owner}:${pull.head}` === head);
      return json(matches.map((pull) => ({ number: pull.number, html_url: pull.html_url })));
    }

    // POST /pulls { title, head, base, body }
    if (method === 'POST' && rest === '/pulls') {
      const number = pulls.length + 1;
      const pull = { number, head: body.head as string, base: body.base as string, html_url: `https://github.test/pull/${number}` };
      pulls.push(pull);
      return json({ number, html_url: pull.html_url });
    }

    return json({ message: `Unhandled ${method} ${rest}` }, 500);
  }) as typeof fetch;

  return {
    fetch: fakeFetch,
    calls,
    get forceNonFastForward() {
      return state.forceNonFastForward;
    },
    set forceNonFastForward(value: boolean) {
      state.forceNonFastForward = value;
    },
    get forceTruncated() {
      return state.forceTruncated;
    },
    set forceTruncated(value: boolean) {
      state.forceTruncated = value;
    },
    get forceRefAlreadyExists() {
      return state.forceRefAlreadyExists;
    },
    set forceRefAlreadyExists(value: boolean) {
      state.forceRefAlreadyExists = value;
    },
    branchSha: (branch: string) => branches.get(branch),
  };
}
