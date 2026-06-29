import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPath, joinKey, matchPath, parsePattern, splitKey } from '../src/index.ts';
import { GitSyncError } from '../src/index.ts';

test('parsePattern validates and reports namespace presence', () => {
  const single = parsePattern('messages/{locale}.json');
  assert.equal(single.hasNamespace, false);
  assert.equal(single.listPrefix, 'messages');

  const ns = parsePattern('locales/{locale}/{namespace}.json');
  assert.equal(ns.hasNamespace, true);
  assert.equal(ns.listPrefix, 'locales');

  const nested = parsePattern('src/i18n/{locale}.json');
  assert.equal(nested.listPrefix, 'src/i18n');
});

test('parsePattern rejects bad patterns', () => {
  assert.throws(() => parsePattern('messages/en.json'), GitSyncError); // no {locale}
  assert.throws(() => parsePattern('messages/{lang}.json'), GitSyncError); // unknown placeholder
  assert.throws(() => parsePattern('/abs/{locale}.json'), GitSyncError); // absolute
  assert.throws(() => parsePattern('../{locale}.json'), GitSyncError); // traversal
});

test('formatPath fills placeholders', () => {
  const single = parsePattern('messages/{locale}.json');
  assert.equal(formatPath(single, { locale: 'de' }), 'messages/de.json');

  const ns = parsePattern('locales/{locale}/{namespace}.json');
  assert.equal(formatPath(ns, { locale: 'pt-BR', namespace: 'auth' }), 'locales/pt-BR/auth.json');
});

test('matchPath is the inverse of formatPath', () => {
  const ns = parsePattern('locales/{locale}/{namespace}.json');
  assert.deepEqual(matchPath(ns, 'locales/en/auth.json'), { locale: 'en', namespace: 'auth' });
  assert.deepEqual(matchPath(ns, 'locales/pt-BR/home.json'), { locale: 'pt-BR', namespace: 'home' });
  assert.equal(matchPath(ns, 'README.md'), null);
  assert.equal(matchPath(ns, 'locales/en/auth.yaml'), null);

  const single = parsePattern('messages/{locale}.json');
  assert.deepEqual(matchPath(single, 'messages/fr.json'), { locale: 'fr' });
  assert.equal(matchPath(single, 'messages/sub/fr.json'), null); // no extra segments
});

test('splitKey / joinKey round-trip with and without namespaces', () => {
  assert.deepEqual(splitKey('auth.login.title', true), { namespace: 'auth', localKey: 'login.title' });
  assert.deepEqual(splitKey('home.title', false), { localKey: 'home.title' });
  assert.equal(splitKey('title', true), null); // single segment cannot be namespaced
  assert.equal(splitKey('trailing.', true), null);

  assert.equal(joinKey('auth', 'login.title'), 'auth.login.title');
  assert.equal(joinKey(undefined, 'home.title'), 'home.title');
});
