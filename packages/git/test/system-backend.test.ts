import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocaleConfig, TranslationEntry } from '@glot-manager/core';
import { createGitTranslationStore, fixedClock, NonFastForwardError } from '../src/index.ts';
import { createSystemGitBackend } from '../src/backends/system.ts';

let hasGit = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  hasGit = false;
}

const IDENTITY_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Seed',
  GIT_AUTHOR_EMAIL: 'seed@x.test',
  GIT_COMMITTER_NAME: 'Seed',
  GIT_COMMITTER_EMAIL: 'seed@x.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

const locales: LocaleConfig = { locales: ['en', 'de'], defaultLocale: 'en' };
const PATTERN = 'messages/{locale}.json';
const CLOCK = fixedClock('2026-06-29T12:00:00.000Z');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: IDENTITY_ENV, encoding: 'utf-8' });
}

/** Create a bare repo seeded with one commit on `main`, return its path. */
function seedRemote(root: string): string {
  git(root, ['init', '--bare', '-b', 'main', 'remote.git']);
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  git(root, ['clone', remote, 'seed']);
  mkdirSync(join(seed, 'messages'), { recursive: true });
  writeFileSync(join(seed, 'messages', 'en.json'), '{\n  "home": {\n    "title": "Hi"\n  }\n}\n');
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-m', 'seed']);
  git(seed, ['push', 'origin', 'HEAD:main']);
  return remote;
}

function entry(key: string, values: Record<string, string>): TranslationEntry {
  return { key, namespace: key.slice(0, key.lastIndexOf('.')), sourceLocale: 'en', values };
}

test('system backend: import → publish → file lands in the remote (byte-exact)', { skip: !hasGit }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'glot-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = seedRemote(root);
  const backend = createSystemGitBackend({ remoteUrl: remote, dir: join(root, 'work') });
  const store = createGitTranslationStore({ backend, pattern: PATTERN, locales, clock: CLOCK });

  return (async () => {
    const imported = await store.import();
    const byKey = new Map(imported.entries.map((e) => [e.key, e.values]));
    assert.deepEqual(byKey.get('home.title'), { en: 'Hi' });

    const result = await store.publish({
      entries: [entry('home.title', { en: 'Hi', de: 'Hallo' })],
      target: { mode: 'commit', branch: 'main' },
      message: 'add de',
    });
    assert.equal(result.applied, true);

    // Verify by re-cloning the remote and reading the bytes.
    const verify = join(root, 'verify');
    git(root, ['clone', remote, 'verify']);
    const bytes = readFileSync(join(verify, 'messages', 'de.json'));
    assert.deepEqual(bytes, Buffer.from('{\n  "home": {\n    "title": "Hallo"\n  }\n}\n', 'utf-8'));
  })();
});

test('system backend: a stale base is rejected as NonFastForwardError', { skip: !hasGit }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'glot-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = seedRemote(root);
  const backend = createSystemGitBackend({ remoteUrl: remote, dir: join(root, 'work') });

  return (async () => {
    const base = await backend.resolveRef({ branch: 'main' });

    // Another writer advances main out-of-band.
    const other = join(root, 'other');
    git(root, ['clone', remote, 'other']);
    writeFileSync(join(other, 'README.md'), 'hello\n');
    git(other, ['add', '-A']);
    git(other, ['commit', '-m', 'other']);
    git(other, ['push', 'origin', 'HEAD:main']);

    await assert.rejects(
      backend.commit({
        base, // stale
        branch: 'main',
        message: 'conflicting',
        author: { name: 'b', email: 'b@x.test', date: new Date('2026-06-29T12:00:00Z') },
        changes: [{ path: 'messages/de.json', content: '{}\n' }],
      }),
      NonFastForwardError,
    );
  })();
});

test('system backend: the engine retries a non-fast-forward and converges', { skip: !hasGit }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'glot-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = seedRemote(root);
  const backend = createSystemGitBackend({ remoteUrl: remote, dir: join(root, 'work') });
  const store = createGitTranslationStore({ backend, pattern: PATTERN, locales, clock: CLOCK });

  return (async () => {
    // Prime the working clone so its origin/main is stale.
    await store.import();
    const other = join(root, 'other');
    git(root, ['clone', remote, 'other']);
    writeFileSync(join(other, 'messages', 'fr.json'), '{}\n');
    git(other, ['add', '-A']);
    git(other, ['commit', '-m', 'fr']);
    git(other, ['push', 'origin', 'HEAD:main']);

    const result = await store.publish({
      entries: [entry('home.title', { en: 'Hi', de: 'Hallo' })],
      target: { mode: 'commit', branch: 'main' },
      message: 'add de',
      retries: 3,
    });
    assert.equal(result.applied, true);

    const verify = join(root, 'verify');
    git(root, ['clone', remote, 'verify']);
    // Both the concurrent fr.json and our de.json survive.
    assert.ok(readFileSync(join(verify, 'messages', 'fr.json')));
    assert.deepEqual(JSON.parse(readFileSync(join(verify, 'messages', 'de.json'), 'utf-8')), { home: { title: 'Hallo' } });
  })();
});
