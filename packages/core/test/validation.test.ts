import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffTokens,
  extractTokens,
  tokensMatch,
  validateTranslationValues,
  errorsOnly,
} from '../src/index.ts';

test('extractTokens finds simple placeholders', () => {
  const tokens = extractTokens('Hello {name}, you have {count} messages');
  const placeholders = tokens.filter((t) => t.kind === 'placeholder').map((t) => t.value);
  assert.deepEqual(placeholders.sort(), ['count', 'name']);
});

test('extractTokens finds ICU plural arguments', () => {
  const tokens = extractTokens('{count, plural, one {# item} other {# items}}');
  assert.ok(tokens.some((t) => t.kind === 'icuArg' && t.value === 'count'));
});

test('extractTokens finds printf, html tags, and newlines', () => {
  const tokens = extractTokens('Line one\nSee <b>%1$s</b> and %d');
  assert.ok(tokens.some((t) => t.kind === 'printf' && t.value === '%1$s'));
  assert.ok(tokens.some((t) => t.kind === 'printf' && t.value === '%d'));
  assert.ok(tokens.some((t) => t.kind === 'tag' && t.value === 'b'));
  assert.equal(tokens.filter((t) => t.kind === 'newline').length, 1);
});

test('tokensMatch ignores reordering and surrounding text', () => {
  assert.ok(tokensMatch('Hello {name}, {count} new', 'Bonjour {name}, {count} nouveaux'));
});

test('escaped %% is not tokenized (no phantom conversion)', () => {
  const tokens = extractTokens('50%% off');
  assert.equal(
    tokens.filter((t) => t.kind === 'printf').length,
    0,
    '%% must not produce a printf token',
  );
  // A real translation that changes the word after %% must still match.
  assert.ok(tokensMatch('Get 20%% off', 'Erhalte 20%% Rabatt'));
});

test('nested ICU argument reference is not double-counted', () => {
  const tokens = extractTokens('{count, plural, other {{count} items}}');
  assert.equal(tokens.filter((t) => t.kind === 'icuArg').length, 1);
  assert.equal(
    tokens.filter((t) => t.kind === 'placeholder').length,
    0,
    'inner {count} reference must not count as a separate placeholder',
  );
  // Differing plural-branch structure across languages must not be a mismatch.
  assert.ok(
    tokensMatch(
      '{count, plural, one {# item} other {# items}}',
      '{count, plural, one {# Element} few {# Elementy} other {# Elementów}}',
    ),
  );
});

test('diffTokens reports a dropped placeholder', () => {
  const { missing, added } = diffTokens('Hi {name} ({count})', 'Hallo {name}');
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.value, 'count');
  assert.equal(added.length, 0);
});

test('diffTokens reports an invented placeholder', () => {
  const { missing, added } = diffTokens('Hi {name}', 'Hallo {name} {extra}');
  assert.equal(added.length, 1);
  assert.equal(added[0]?.value, 'extra');
  assert.equal(missing.length, 0);
});

test('validateTranslationValues flags missing, empty, mismatched, and copies', () => {
  const job = {
    sourceLocale: 'en',
    sourceText: 'Save {count} items',
    targetLocales: ['de', 'fr', 'it'],
  };
  const issues = validateTranslationValues(job, {
    de: 'Speichere {count} Elemente', // ok
    fr: 'Enregistrer les éléments', // missing {count}
    // it missing entirely
  });

  const byLocale = (locale: string) => issues.filter((i) => i.locale === locale);
  assert.equal(byLocale('de').length, 0);
  assert.equal(byLocale('fr')[0]?.code, 'token_mismatch');
  assert.equal(byLocale('it')[0]?.code, 'missing_locale');
});

test('validateTranslationValues flags a suspicious identical copy as a warning', () => {
  const issues = validateTranslationValues(
    { sourceLocale: 'en', sourceText: 'Dashboard', targetLocales: ['de'] },
    { de: 'Dashboard' },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'suspicious_copy');
  assert.equal(issues[0]?.severity, 'warning');
  assert.equal(errorsOnly(issues).length, 0);
});
