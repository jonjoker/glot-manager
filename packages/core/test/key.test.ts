import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyKeyAliases, isEditableKey, isValidKey, leafOf, namespaceOf } from '../src/index.ts';

test('namespaceOf and leafOf split on the last dot', () => {
  assert.equal(namespaceOf('a.b.c'), 'a.b');
  assert.equal(leafOf('a.b.c'), 'c');
  assert.equal(namespaceOf('flat'), '');
  assert.equal(leafOf('flat'), 'flat');
});

test('isValidKey rejects unsafe and malformed keys', () => {
  assert.ok(isValidKey('selfService.research.options.pvCurtailment'));
  assert.ok(!isValidKey(''));
  assert.ok(!isValidKey('a..b'));
  assert.ok(!isValidKey('.leading'));
  assert.ok(!isValidKey('trailing.'));
  assert.ok(!isValidKey('a.__proto__.b'));
  assert.ok(!isValidKey('a.b c'));
});

test('isEditableKey honors prefix boundaries', () => {
  const prefixes = ['selfService', 'ui'];
  assert.ok(isEditableKey('selfService', prefixes));
  assert.ok(isEditableKey('selfService.x.y', prefixes));
  assert.ok(isEditableKey('ui.button.save', prefixes));
  assert.ok(!isEditableKey('selfServiceX.y', prefixes));
  assert.ok(!isEditableKey('admin.secret', prefixes));
});

test('isEditableKey allows everything when no prefixes are configured', () => {
  assert.ok(isEditableKey('anything.goes', []));
  assert.ok(!isEditableKey('bad..key', []));
});

test('applyKeyAliases rewrites the matching prefix only', () => {
  const aliases = [{ from: 'grid', to: 'gridConnection' }];
  assert.equal(applyKeyAliases('grid.title', aliases), 'gridConnection.title');
  assert.equal(applyKeyAliases('grid', aliases), 'gridConnection');
  assert.equal(applyKeyAliases('gridlock.title', aliases), 'gridlock.title');
});
