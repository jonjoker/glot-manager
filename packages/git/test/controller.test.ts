import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, type LocaleConfig, type TranslationStore } from '@glot-manager/core';
import { fixedClock, wireGitPublish } from '../src/index.ts';
import { createFakeBackend } from './fake-backend.ts';

const locales: LocaleConfig = { locales: ['en', 'de'], defaultLocale: 'en' };
const PATTERN = 'messages/{locale}.json';
const CLOCK = fixedClock('2026-06-29T12:00:00.000Z');

function setup() {
  const store = new MemoryStore({ 'home.title': { values: { en: 'Hi', de: 'Hallo' } } });
  const backend = createFakeBackend({
    main: {
      'messages/en.json': '{\n  "home": {\n    "title": "Hi"\n  }\n}\n',
      'messages/de.json': '{\n  "home": {\n    "title": "Hallo"\n  }\n}\n',
    },
  });
  const controller = wireGitPublish({ backend, store, pattern: PATTERN, locales, clock: CLOCK });
  return { store, backend, controller };
}

test('onChange accumulates a dirty set without publishing', () => {
  const { backend, controller } = setup();
  assert.equal(controller.hasPendingChanges(), false);
  controller.onChange(['home.title']);
  controller.onChange(['home.title', 'nav.pricing']);
  assert.deepEqual(controller.getDirtyKeys().sort(), ['home.title', 'nav.pricing']);
  assert.equal(controller.hasPendingChanges(), true);
  assert.equal(backend.commitCount, 0); // never publishes on change
});

test('handlePublish publishes the snapshot and clears the dirty set', async () => {
  const { store, backend, controller } = setup();
  await store.upsert({ key: 'home.title', values: { de: 'Hallo neu' }, sourceLocale: 'en' });
  controller.onChange(['home.title']);

  const result = await controller.handlePublish({ target: { branch: 'main' } });
  assert.equal(result.applied, true);
  assert.deepEqual(JSON.parse(backend.fileAt('main', 'messages/de.json')!), { home: { title: 'Hallo neu' } });
  assert.equal(controller.hasPendingChanges(), false); // cleared on success
  assert.match(backend.log[0]!.message, /^chore\(i18n\)/); // default message
});

test('handlePublish resolves the default branch when none is given', async () => {
  const { store, controller } = setup();
  await store.upsert({ key: 'home.title', values: { de: 'X' }, sourceLocale: 'en' });
  controller.onChange(['home.title']);
  const result = await controller.handlePublish();
  assert.equal(result.branch, 'main');
  assert.equal(result.applied, true);
});

test('dryRun keeps the dirty set intact', async () => {
  const { store, controller } = setup();
  await store.upsert({ key: 'home.title', values: { de: 'Hallo neu' }, sourceLocale: 'en' });
  controller.onChange(['home.title']);
  const result = await controller.handlePublish({ dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(controller.hasPendingChanges(), true); // not cleared
});

test('an empty dirty set publishes nothing — even if the store has drifted from the repo', async () => {
  // Store holds a value that differs from the repo, but nothing is marked dirty.
  const store = new MemoryStore({ 'home.title': { values: { en: 'Hi', de: 'DRIFTED' } } });
  const backend = createFakeBackend({
    main: {
      'messages/en.json': '{\n  "home": {\n    "title": "Hi"\n  }\n}\n',
      'messages/de.json': '{\n  "home": {\n    "title": "Hallo"\n  }\n}\n',
    },
  });
  const controller = wireGitPublish({ backend, store, pattern: PATTERN, locales, clock: CLOCK });

  const result = await controller.handlePublish({ target: { branch: 'main' } });
  assert.equal(result.applied, false);
  assert.equal(backend.commitCount, 0);
  // The drifted value must NOT have been pushed.
  assert.deepEqual(JSON.parse(backend.fileAt('main', 'messages/de.json')!), { home: { title: 'Hallo' } });
});

test('keys dirtied during an in-flight publish survive the clear', async () => {
  const base = new MemoryStore({ 'home.title': { values: { en: 'Hi', de: 'Hallo' } } });
  const backend = createFakeBackend({
    main: {
      'messages/en.json': '{\n  "home": {\n    "title": "Hi"\n  }\n}\n',
      'messages/de.json': '{\n  "home": {\n    "title": "Hallo"\n  }\n}\n',
    },
  });
  let injected = false;
  const store: TranslationStore = {
    get: (key) => base.get(key),
    upsert: (input) => base.upsert(input),
    list: async (keys) => {
      // A save lands mid-publish, after the dirty set was snapshotted.
      if (!injected) {
        injected = true;
        controller.onChange(['late.key']);
      }
      return base.list(keys);
    },
  };
  const controller = wireGitPublish({ backend, store, pattern: PATTERN, locales, clock: CLOCK, branch: 'main' });

  await base.upsert({ key: 'home.title', values: { de: 'Hallo neu' }, sourceLocale: 'en' });
  controller.onChange(['home.title']);

  const result = await controller.handlePublish({ target: { branch: 'main' } });
  assert.equal(result.applied, true);
  // home.title was reconciled and cleared; late.key (added during the publish) remains.
  assert.deepEqual(controller.getDirtyKeys(), ['late.key']);
});

test('skipCi is forwarded to the engine', async () => {
  const { store, backend, controller } = setup();
  await store.upsert({ key: 'home.title', values: { de: 'Hallo neu' }, sourceLocale: 'en' });
  controller.onChange(['home.title']);
  await controller.handlePublish({ target: { branch: 'main' }, skipCi: true });
  assert.match(backend.log[0]!.message, /\[skip ci\]$/);
});

test('a clean no-op publish still clears the dirty set (already in sync)', async () => {
  const { controller, backend } = setup();
  // Mark dirty but make no real change → publish is clean.
  controller.onChange(['home.title']);
  const result = await controller.handlePublish({ target: { branch: 'main' } });
  assert.equal(result.applied, false);
  assert.equal(result.diff.isClean, true);
  assert.equal(backend.commitCount, 0);
  assert.equal(controller.hasPendingChanges(), false);
});
