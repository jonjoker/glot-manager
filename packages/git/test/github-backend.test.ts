import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubBackend } from '../src/backends/github.ts';
import { GitAuthError, NonFastForwardError, RateLimitedError, RefNotFoundError } from '../src/index.ts';
import { createFakeGitHub } from './fake-github.ts';

function backendFor(gh: ReturnType<typeof createFakeGitHub>) {
  return createGitHubBackend({ owner: 'acme', repo: 'site', token: 'tkn', fetch: gh.fetch, baseUrl: 'https://api.github.com' });
}

const seed = {
  main: { 'messages/en.json': '{\n  "home": {\n    "title": "Hi"\n  }\n}\n' },
};

test('defaultBranch / resolveRef / readFiles / listFiles', async () => {
  const gh = createFakeGitHub('acme', 'site', seed);
  const backend = backendFor(gh);

  assert.equal(await backend.defaultBranch(), 'main');
  const ref = await backend.resolveRef({ branch: 'main' });
  assert.ok(ref.commit);

  const list = await backend.listFiles(ref, 'messages');
  assert.deepEqual(list, ['messages/en.json']);

  const [present, missing] = await backend.readFiles(ref, ['messages/en.json', 'messages/de.json']);
  assert.equal(JSON.parse(present!.content!).home.title, 'Hi');
  assert.equal(missing!.content, null);
});

test('resolveRef throws RefNotFoundError for a missing branch', async () => {
  const gh = createFakeGitHub('acme', 'site', seed);
  await assert.rejects(backendFor(gh).resolveRef({ branch: 'nope' }), RefNotFoundError);
});

test('commit follows blob/tree/commit/update-ref and sends auth', async () => {
  const gh = createFakeGitHub('acme', 'site', seed);
  const backend = backendFor(gh);
  const base = await backend.resolveRef({ branch: 'main' });

  const result = await backend.commit({
    base,
    branch: 'main',
    message: 'update',
    author: { name: 'glot[bot]', email: 'bot@x.test', date: new Date('2026-06-29T12:00:00Z') },
    changes: [{ path: 'messages/de.json', content: '{\n  "home": {\n    "title": "Hallo"\n  }\n}\n' }],
  });
  assert.ok(result.commit);
  assert.match(result.url!, /\/commit\//);

  // Exact API sequence for the commit (captured before any verification reads),
  // and auth on every call.
  const sequence = gh.calls.map((call) => `${call.method} ${call.path.split('?')[0]}`);
  assert.ok(sequence.includes('GET /git/commits/' + base.commit)); // read base tree
  assert.deepEqual(sequence.slice(-3), ['POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main']);
  assert.ok(gh.calls.every((call) => call.authorization === 'Bearer tkn'));

  // The new file is readable at the advanced tip.
  const tip = await backend.resolveRef({ branch: 'main' });
  const [de] = await backend.readFiles(tip, ['messages/de.json']);
  assert.equal(JSON.parse(de!.content!).home.title, 'Hallo');
});

test('a non-fast-forward update maps to NonFastForwardError', async () => {
  const gh = createFakeGitHub('acme', 'site', seed);
  const backend = backendFor(gh);
  const base = await backend.resolveRef({ branch: 'main' });
  gh.forceNonFastForward = true; // PATCH will 422 while the branch still exists

  await assert.rejects(
    backend.commit({
      base,
      branch: 'main',
      message: 'm',
      author: { name: 'b', email: 'b@x.test', date: new Date('2026-06-29T12:00:00Z') },
      changes: [{ path: 'messages/de.json', content: '{}\n' }],
    }),
    NonFastForwardError,
  );
});

test('commit creates the branch when it does not exist (first PR publish)', async () => {
  const gh = createFakeGitHub('acme', 'site', seed);
  const backend = backendFor(gh);
  const base = await backend.resolveRef({ branch: 'main' });

  await backend.commit({
    base,
    branch: 'glot/publish',
    message: 'm',
    author: { name: 'b', email: 'b@x.test', date: new Date('2026-06-29T12:00:00Z') },
    changes: [{ path: 'messages/de.json', content: '{}\n' }],
  });
  assert.ok(gh.branchSha('glot/publish'));
  assert.ok(gh.calls.some((call) => call.method === 'POST' && call.path === '/git/refs'));
});

test('openPullRequest creates then reuses by head branch', async () => {
  const gh = createFakeGitHub('acme', 'site', seed);
  const backend = backendFor(gh);

  const created = await backend.openPullRequest!({ base: 'main', head: 'glot/publish', title: 't', body: 'b' });
  assert.equal(created.reused, false);
  const reused = await backend.openPullRequest!({ base: 'main', head: 'glot/publish', title: 't', body: 'b' });
  assert.equal(reused.reused, true);
  assert.equal(reused.number, created.number);
});

test('a 401 maps to GitAuthError', async () => {
  const unauthorized = (async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })) as typeof fetch;
  const backend = createGitHubBackend({ owner: 'acme', repo: 'site', token: 'bad', fetch: unauthorized });
  await assert.rejects(backend.defaultBranch(), GitAuthError);
});

test('rejects construction without owner/repo/token', () => {
  assert.throws(() => createGitHubBackend({ owner: '', repo: 'r', token: 't' }));
  assert.throws(() => createGitHubBackend({ owner: 'o', repo: 'r', token: '' }), GitAuthError);
});

test('a truncated recursive tree fails loudly instead of listing a partial set', async () => {
  const gh = createFakeGitHub('acme', 'site', seed);
  gh.forceTruncated = true;
  const backend = backendFor(gh);
  const ref = await backend.resolveRef({ branch: 'main' });
  await assert.rejects(backend.listFiles(ref, 'messages'), /truncated/);
});

test('a ref-creation race (422 already exists) maps to NonFastForwardError so the engine retries', async () => {
  const gh = createFakeGitHub('acme', 'site', seed);
  const backend = backendFor(gh);
  const base = await backend.resolveRef({ branch: 'main' });
  gh.forceRefAlreadyExists = true; // POST /git/refs → 422 "Reference already exists"
  await assert.rejects(
    backend.commit({
      base,
      branch: 'glot/new',
      message: 'm',
      author: { name: 'b', email: 'b@x.test', date: new Date('2026-06-29T12:00:00Z') },
      changes: [{ path: 'messages/de.json', content: '{}\n' }],
    }),
    NonFastForwardError,
  );
});

test('a 403 rate-limit maps to RateLimitedError, not GitAuthError', async () => {
  const limited = (async () =>
    new Response(JSON.stringify({ message: 'API rate limit exceeded for installation' }), { status: 403 })) as typeof fetch;
  const backend = createGitHubBackend({ owner: 'a', repo: 'r', token: 't', fetch: limited });
  await assert.rejects(backend.defaultBranch(), RateLimitedError);
});

test('an empty file is decoded inline without a redundant blob request', async () => {
  const gh = createFakeGitHub('acme', 'site', { main: { 'messages/empty.json': '' } });
  const backend = backendFor(gh);
  const ref = await backend.resolveRef({ branch: 'main' });
  const [empty] = await backend.readFiles(ref, ['messages/empty.json']);
  assert.equal(empty!.content, '');
  assert.ok(!gh.calls.some((call) => call.path.startsWith('/git/blobs/')));
});
