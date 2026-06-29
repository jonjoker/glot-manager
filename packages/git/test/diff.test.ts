import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocaleConfig, MessageTree, TranslationEntry } from '@glot-manager/core';
import { parsePattern, planPublish, stringifyMessageTree, type FileChange } from '../src/index.ts';

const pattern = parsePattern('messages/{locale}.json');
const en: LocaleConfig = { locales: ['en'], defaultLocale: 'en' };
const enDe: LocaleConfig = { locales: ['en', 'de'], defaultLocale: 'en' };

function entry(key: string, values: Record<string, string>): TranslationEntry {
  return { key, namespace: key.slice(0, key.lastIndexOf('.')), sourceLocale: 'en', values };
}
function repoFile(path: string, tree: MessageTree): FileChange {
  return { path, content: stringifyMessageTree(tree, {}) };
}

test('clean snapshot is a no-op', () => {
  const candidate = [entry('a.x', { en: '1' }), entry('a.y', { en: '2' })];
  const current = [repoFile('messages/en.json', { a: { x: '1', y: '2' } })];
  const diff = planPublish(candidate, current, en, pattern);
  assert.equal(diff.isClean, true);
  assert.deepEqual(diff.changedFiles, []);
  assert.deepEqual(diff.unchanged.sort(), ['a.x', 'a.y']);
});

test('added + modified are detected and merged into the file', () => {
  const candidate = [entry('a.x', { en: '1b' }), entry('a.y', { en: '2' }), entry('a.z', { en: '3' })];
  const current = [repoFile('messages/en.json', { a: { x: '1', y: '2' } })];
  const diff = planPublish(candidate, current, en, pattern);
  assert.deepEqual(diff.modified, ['a.x']);
  assert.deepEqual(diff.added, ['a.z']);
  assert.deepEqual(diff.unchanged, ['a.y']);
  assert.equal(diff.changedFiles.length, 1);
  assert.deepEqual(JSON.parse(diff.changedFiles[0]!.content!), { a: { x: '1b', y: '2', z: '3' } });
});

test('targeted merge preserves keys another writer added concurrently', () => {
  // The repo has `a.w` which is not in our working copy at all.
  const candidate = [entry('a.x', { en: '1b' }), entry('a.y', { en: '2' })];
  const current = [repoFile('messages/en.json', { a: { x: '1', y: '2', w: '9' } })];
  const diff = planPublish(candidate, current, en, pattern, { scope: ['a.x'] });
  assert.equal(diff.changedFiles.length, 1);
  const written = JSON.parse(diff.changedFiles[0]!.content!);
  assert.equal(written.a.w, '9'); // preserved, not clobbered
  assert.equal(written.a.x, '1b'); // our change applied
  assert.equal(written.a.y, '2');
});

test('without prune, a repo-only key is reported removed but left in place', () => {
  const candidate = [entry('a.x', { en: '1' })];
  const current = [repoFile('messages/en.json', { a: { x: '1', y: '2' } })];
  const diff = planPublish(candidate, current, en, pattern);
  assert.deepEqual(diff.removed, ['a.y']);
  assert.equal(diff.isClean, true); // nothing written: y stays
  assert.deepEqual(diff.changedFiles, []);
});

test('prune rebuilds the file and removes absent keys', () => {
  const candidate = [entry('a.x', { en: '1' })];
  const current = [repoFile('messages/en.json', { a: { x: '1', y: '2' } })];
  const diff = planPublish(candidate, current, en, pattern, { prune: true });
  assert.deepEqual(diff.removed, ['a.y']);
  assert.equal(diff.changedFiles.length, 1);
  assert.deepEqual(JSON.parse(diff.changedFiles[0]!.content!), { a: { x: '1' } });
});

test('per-locale: only the changed locale file is rewritten', () => {
  const candidate = [entry('a.x', { en: '1', de: 'eins-neu' })];
  const current = [
    repoFile('messages/en.json', { a: { x: '1' } }),
    repoFile('messages/de.json', { a: { x: 'eins' } }),
  ];
  const diff = planPublish(candidate, current, enDe, pattern, { scope: ['a.x'] });
  assert.equal(diff.changedFiles.length, 1);
  assert.equal(diff.changedFiles[0]!.path, 'messages/de.json');
  assert.deepEqual(JSON.parse(diff.changedFiles[0]!.content!), { a: { x: 'eins-neu' } });
});

test('prune combined with a scope is rejected (would silently drop out-of-scope keys)', () => {
  const candidate = [entry('a.x', { en: '1' })];
  const current = [repoFile('messages/en.json', { a: { x: '1', y: '2' } })];
  assert.throws(() => planPublish(candidate, current, en, pattern, { prune: true, scope: ['a.x'] }), /prune cannot be combined/);
});

test('missingLocale "empty" never overwrites an existing repo translation', () => {
  // Candidate only carries `en`; the repo already has a `de` translation.
  const candidate = [entry('a.x', { en: '1' })];
  const current = [
    repoFile('messages/en.json', { a: { x: '1' } }),
    repoFile('messages/de.json', { a: { x: 'eins' } }),
  ];
  const diff = planPublish(candidate, current, enDe, pattern, { serialize: { missingLocale: 'empty' } });
  // de/a.x must stay "eins", not be blanked to "".
  assert.equal(diff.isClean, true);
  assert.deepEqual(diff.changedFiles, []);
});

test('missingLocale "empty" does mark a genuinely new untranslated key', () => {
  const candidate = [entry('a.x', { en: '1' })]; // no de value, and de file has no a.x
  const current = [repoFile('messages/en.json', { a: { x: '1' } })];
  const diff = planPublish(candidate, current, enDe, pattern, { serialize: { missingLocale: 'empty' } });
  const de = diff.changedFiles.find((f) => f.path === 'messages/de.json');
  assert.equal(JSON.parse(de!.content!).a.x, ''); // new key gets the marker
});

test('summary counts line up', () => {
  const candidate = [entry('a.x', { en: '1b' }), entry('a.z', { en: '3' })];
  const current = [repoFile('messages/en.json', { a: { x: '1' } })];
  const diff = planPublish(candidate, current, en, pattern);
  assert.deepEqual(diff.summary, { added: 1, modified: 1, removed: 0, files: 1 });
});
