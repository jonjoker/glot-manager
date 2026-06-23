import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceTranslationResult,
  createEchoTranslator,
  parseJsonObject,
  parseTranslationResponse,
  TranslatorError,
} from '../src/index.ts';

test('parseJsonObject parses plain JSON', () => {
  assert.deepEqual(parseJsonObject('{"de":"x"}'), { de: 'x' });
});

test('parseJsonObject tolerates code fences', () => {
  assert.deepEqual(parseJsonObject('```json\n{"de":"x"}\n```'), { de: 'x' });
});

test('parseJsonObject slices out surrounding prose', () => {
  assert.deepEqual(parseJsonObject('Sure! Here: {"de":"x"} — done'), { de: 'x' });
});

test('parseJsonObject throws on non-JSON', () => {
  assert.throws(() => parseJsonObject('not json at all'), TranslatorError);
});

test('coerceTranslationResult keeps expected locales and rejects missing ones', () => {
  const result = coerceTranslationResult({ de: 'a', fr: 'b', extra: 'c' }, ['de', 'fr']);
  assert.deepEqual(result, { de: 'a', fr: 'b' });
  assert.throws(() => coerceTranslationResult({ de: 'a' }, ['de', 'fr']), TranslatorError);
});

test('parseTranslationResponse end-to-end', () => {
  const values = parseTranslationResponse('{"de":"Hallo","fr":"Bonjour"}', ['de', 'fr']);
  assert.deepEqual(values, { de: 'Hallo', fr: 'Bonjour' });
});

test('echo translator preserves placeholders and fills every target', async () => {
  const translator = createEchoTranslator();
  const values = await translator.translate({
    sourceLocale: 'en',
    sourceText: 'Hi {name}',
    targetLocales: ['de', 'fr'],
  });
  assert.equal(values.de, '[de] Hi {name}');
  assert.equal(values.fr, '[fr] Hi {name}');
});
