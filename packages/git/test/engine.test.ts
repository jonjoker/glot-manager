import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocaleConfig, TranslationEntry } from '@glot-manager/core';
import { AbortedError, createGitTranslationStore, fixedClock, NotSupportedError, type GitBackend } from '../src/index.ts';
import { createFakeBackend } from './fake-backend.ts';

const locales: LocaleConfig = { locales: ['en', 'de'], defaultLocale: 'en' };
const PATTERN = 'messages/{locale}.json';
const CLOCK = fixedClock('2026-06-29T12:00:00.000Z');

function entry(key: string, values: Record<string, string>): TranslationEntry {
  return { key, namespace: key.slice(0, key.lastIndexOf('.')), sourceLocale: 'en', values };
}

function seededBackend() {
  return createFakeBackend({
    main: {
      'messages/en.json': '{\n  "home": {\n    "title": "Hi"\n  }\n}\n',
      'messages/de.json': '{\n  "home": {\n    "title": "Hallo"\n  }\n}\n',
    },
  });
}

function store(backend: GitBackend) {
  return createGitTranslationStore({ backend, pattern: PATTERN, locales, clock: CLOCK });
}

test('import reads repo files into entries', async () => {
  const result = await store(seededBackend()).import();
  assert.equal(result.branch, 'main');
  assert.deepEqual(result.warnings, []);
  const byKey = new Map(result.entries.map((entry) => [entry.key, entry.values]));
  assert.deepEqual(byKey.get('home.title'), { en: 'Hi', de: 'Hallo' });
});

test('status reports a diff without writing', async () => {
  const backend = seededBackend();
  const diff = await store(backend).status({ entries: [entry('home.title', { en: 'Hi', de: 'Hallo neu' })] });
  assert.deepEqual(diff.modified, ['home.title']);
  assert.equal(diff.changedFiles.length, 1);
  assert.equal(backend.commitCount, 0); // read-only
});

test('publish commits in commit mode, is idempotent on the second run', async () => {
  const backend = seededBackend();
  const s = store(backend);
  const entries = [entry('home.title', { en: 'Hi', de: 'Hallo neu' })];

  const first = await s.publish({ entries, target: { mode: 'commit', branch: 'main' }, message: 'update de' });
  assert.equal(first.applied, true);
  assert.equal(backend.commitCount, 1);
  assert.deepEqual(JSON.parse(backend.fileAt('main', 'messages/de.json')!), { home: { title: 'Hallo neu' } });
  assert.equal(first.commit?.sha, backend.branchTip('main'));

  const second = await s.publish({ entries, target: { mode: 'commit', branch: 'main' }, message: 'update de' });
  assert.equal(second.applied, false); // clean → no-op
  assert.equal(backend.commitCount, 1);
});

test('dryRun computes the diff but never commits', async () => {
  const backend = seededBackend();
  const result = await store(backend).publish({
    entries: [entry('home.title', { en: 'Hi', de: 'Hallo neu' })],
    target: { mode: 'commit', branch: 'main' },
    message: 'x',
    dryRun: true,
  });
  assert.equal(result.applied, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.diff.changedFiles.length, 1);
  assert.equal(backend.commitCount, 0);
});

test('publish retries past a non-fast-forward and still lands one commit', async () => {
  const backend = seededBackend();
  backend.injectNonFastForward = 1; // first commit attempt fails, second succeeds
  const result = await store(backend).publish({
    entries: [entry('home.title', { en: 'Hi', de: 'Hallo neu' })],
    target: { mode: 'commit', branch: 'main' },
    message: 'update de',
    retries: 3,
  });
  assert.equal(result.applied, true);
  assert.equal(backend.commitCount, 1);
  assert.deepEqual(JSON.parse(backend.fileAt('main', 'messages/de.json')!), { home: { title: 'Hallo neu' } });
});

test('publish gives up after exhausting retries', async () => {
  const backend = seededBackend();
  backend.injectNonFastForward = 5;
  await assert.rejects(
    store(backend).publish({
      entries: [entry('home.title', { en: 'Hi', de: 'x' })],
      target: { mode: 'commit', branch: 'main' },
      message: 'm',
      retries: 2,
    }),
    /advanced past/,
  );
});

test('message builder receives the diff; clock drives the commit date', async () => {
  const backend = seededBackend();
  await store(backend).publish({
    entries: [entry('home.title', { en: 'Hi', de: 'Hallo neu' })],
    target: { mode: 'commit', branch: 'main' },
    message: (diff) => `i18n: ${diff.summary.modified} modified`,
  });
  assert.deepEqual(backend.log, [{ message: 'i18n: 1 modified', date: '2026-06-29T12:00:00.000Z' }]);
});

test('skipCi appends the marker', async () => {
  const backend = seededBackend();
  await store(backend).publish({
    entries: [entry('home.title', { en: 'Hi', de: 'Hallo neu' })],
    target: { mode: 'commit', branch: 'main' },
    message: 'update',
    skipCi: true,
  });
  assert.match(backend.log[0]!.message, /\[skip ci\]$/);
});

test('pull-request mode opens a PR off a fresh branch, then reuses it', async () => {
  const backend = seededBackend();
  const s = store(backend);
  const first = await s.publish({
    entries: [entry('home.title', { en: 'Hi', de: 'Hallo neu' })],
    target: { mode: 'pull-request', branch: 'glot/publish', base: 'main' },
    message: 'translations',
  });
  assert.equal(first.applied, true);
  assert.equal(first.pullRequest?.reused, false);
  assert.equal(backend.prCount, 1);
  // The PR branch exists now; the base branch is untouched.
  assert.ok(backend.branchTip('glot/publish'));
  assert.deepEqual(JSON.parse(backend.fileAt('main', 'messages/de.json')!), { home: { title: 'Hallo' } });

  const second = await s.publish({
    entries: [entry('home.title', { en: 'Hi', de: 'Hallo neuer' })],
    target: { mode: 'pull-request', branch: 'glot/publish', base: 'main' },
    message: 'translations',
  });
  assert.equal(second.pullRequest?.reused, true);
  assert.equal(backend.prCount, 1); // not duplicated
});

test('an already-aborted signal rejects with AbortedError', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store(seededBackend()).import({ signal: controller.signal }), AbortedError);
  await assert.rejects(
    store(seededBackend()).publish({
      entries: [entry('home.title', { en: 'Hi', de: 'x' })],
      target: { mode: 'commit', branch: 'main' },
      message: 'm',
      signal: controller.signal,
    }),
    AbortedError,
  );
});

test('pull-request mode is rejected by a backend that cannot open PRs', async () => {
  const backend = seededBackend();
  const noPr: GitBackend = { ...backend, capabilities: { pullRequests: false, workingTree: true } };
  delete (noPr as { openPullRequest?: unknown }).openPullRequest;
  await assert.rejects(
    store(noPr).publish({
      entries: [entry('home.title', { en: 'Hi', de: 'x' })],
      target: { mode: 'pull-request', branch: 'glot/publish' },
      message: 'm',
    }),
    NotSupportedError,
  );
});
