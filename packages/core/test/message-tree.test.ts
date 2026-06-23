import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessageTree,
  getMessageValue,
  setMessageValue,
  type MessageTree,
  type TranslationEntry,
} from '../src/index.ts';

const entry = (key: string, values: Record<string, string>): TranslationEntry => ({
  key,
  namespace: key.slice(0, key.lastIndexOf('.')),
  values,
  sourceLocale: 'en',
});

test('buildMessageTree assembles a nested tree for one locale', () => {
  const tree = buildMessageTree(
    [
      entry('app.title', { en: 'Dashboard', de: 'Übersicht' }),
      entry('app.nav.home', { en: 'Home', de: 'Start' }),
    ],
    'de',
  );
  assert.equal(getMessageValue(tree, 'app.title'), 'Übersicht');
  assert.equal(getMessageValue(tree, 'app.nav.home'), 'Start');
});

test('buildMessageTree skips entries missing the requested locale', () => {
  const tree = buildMessageTree([entry('app.only', { en: 'x' })], 'de');
  assert.equal(getMessageValue(tree, 'app.only'), undefined);
});

test('buildMessageTree applies prefix aliases', () => {
  const tree = buildMessageTree([entry('grid.connection.title', { en: 'Grid' })], 'en', {
    aliases: [{ from: 'grid', to: 'gridConnection' }],
  });
  assert.equal(getMessageValue(tree, 'gridConnection.connection.title'), 'Grid');
});

test('setMessageValue refuses prototype pollution', () => {
  const tree: MessageTree = Object.create(null) as MessageTree;
  setMessageValue(tree, '__proto__.polluted', 'boom');
  setMessageValue(tree, 'constructor.prototype.polluted', 'boom');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.keys(tree).length, 0);
});

test('setMessageValue does not clobber a branch with a leaf', () => {
  const tree: MessageTree = Object.create(null) as MessageTree;
  setMessageValue(tree, 'a.b', 'leaf');
  setMessageValue(tree, 'a', 'should-not-replace-branch');
  assert.equal(getMessageValue(tree, 'a.b'), 'leaf');
});
