import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocaleConfig, TranslationEntry } from '@glot-manager/core';
import {
  entriesToFiles,
  filesToEntries,
  flattenMessageTree,
  parseMessageTree,
  parsePattern,
  stringifyMessageTree,
  type FileChange,
} from '../src/index.ts';

const locales: LocaleConfig = { locales: ['en', 'de'], defaultLocale: 'en' };

const entries: TranslationEntry[] = [
  { key: 'home.title', namespace: 'home', sourceLocale: 'en', values: { en: 'Hi', de: 'Hallo' } },
  { key: 'home.sub', namespace: 'home', sourceLocale: 'en', values: { en: 'Subtitle' } }, // no de
  { key: 'nav.pricing', namespace: 'nav', sourceLocale: 'en', values: { en: 'Pricing', de: 'Preise' } },
];

function fileMap(files: FileChange[]): Map<string, string | null> {
  return new Map(files.map((file) => [file.path, file.content]));
}

test('stringifyMessageTree: 2-space indent, trailing newline, literal non-ASCII', () => {
  const out = stringifyMessageTree({ greeting: 'Grüezi 🇨🇭', nested: { x: 'y' } } as never);
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
  assert.match(out, /\n {2}"greeting"/); // 2-space indent
  assert.ok(out.includes('Grüezi 🇨🇭')); // never \u-escaped
});

test('flattenMessageTree keeps strings, reports non-string leaves', () => {
  const { values, skipped } = flattenMessageTree({ a: { b: 'x', c: [1, 2], d: 5 } });
  assert.deepEqual(values, { 'a.b': 'x' });
  assert.deepEqual(skipped.sort(), ['a.c', 'a.d']);
});

test('parseMessageTree rejects non-objects and bad JSON', () => {
  assert.throws(() => parseMessageTree('not json'), /Invalid JSON/);
  assert.throws(() => parseMessageTree('[1,2]'), /must contain a JSON object/);
  assert.deepEqual(parseMessageTree('{"a":"b"}'), { a: 'b' });
});

test('entriesToFiles: single file per locale, missing target omitted', () => {
  const pattern = parsePattern('messages/{locale}.json');
  const files = fileMap(entriesToFiles(entries, locales, pattern, { keyOrder: 'alpha' }));

  assert.deepEqual(JSON.parse(files.get('messages/en.json')!), {
    home: { sub: 'Subtitle', title: 'Hi' },
    nav: { pricing: 'Pricing' },
  });
  // de is missing home.sub → key omitted entirely.
  assert.deepEqual(JSON.parse(files.get('messages/de.json')!), {
    home: { title: 'Hallo' },
    nav: { pricing: 'Preise' },
  });
});

test('entriesToFiles: missingLocale "empty" writes a marker', () => {
  const pattern = parsePattern('messages/{locale}.json');
  const files = fileMap(entriesToFiles(entries, locales, pattern, { keyOrder: 'alpha', missingLocale: 'empty' }));
  assert.equal(JSON.parse(files.get('messages/de.json')!).home.sub, '');
});

test('entriesToFiles: namespace-per-file layout', () => {
  const pattern = parsePattern('locales/{locale}/{namespace}.json');
  const files = fileMap(entriesToFiles(entries, locales, pattern, { keyOrder: 'alpha' }));
  assert.deepEqual([...files.keys()].sort(), [
    'locales/de/home.json',
    'locales/de/nav.json',
    'locales/en/home.json',
    'locales/en/nav.json',
  ]);
  assert.deepEqual(JSON.parse(files.get('locales/en/home.json')!), { sub: 'Subtitle', title: 'Hi' });
  assert.deepEqual(JSON.parse(files.get('locales/de/nav.json')!), { pricing: 'Preise' });
});

test('round-trip: filesToEntries(entriesToFiles(x)) recovers the values', () => {
  const pattern = parsePattern('locales/{locale}/{namespace}.json');
  const files = entriesToFiles(entries, locales, pattern, { keyOrder: 'alpha' });
  const { entries: recovered, warnings } = filesToEntries(files, pattern, 'en');
  assert.deepEqual(warnings, []);

  const byKey = new Map(recovered.map((entry) => [entry.key, entry.values]));
  assert.deepEqual(byKey.get('home.title'), { en: 'Hi', de: 'Hallo' });
  assert.deepEqual(byKey.get('home.sub'), { en: 'Subtitle' }); // de still absent
  assert.deepEqual(byKey.get('nav.pricing'), { en: 'Pricing', de: 'Preise' });
});

test('round-trip is byte-identical when re-serialized', () => {
  const pattern = parsePattern('messages/{locale}.json');
  const first = entriesToFiles(entries, locales, pattern, { keyOrder: 'alpha' });
  const { entries: recovered } = filesToEntries(first, pattern, 'en');
  const recoveredEntries: TranslationEntry[] = recovered.map((entry) => ({
    key: entry.key,
    namespace: entry.namespace ?? '',
    values: entry.values,
    sourceLocale: entry.sourceLocale,
  }));
  const second = entriesToFiles(recoveredEntries, locales, pattern, { keyOrder: 'alpha' });
  assert.deepEqual(second, first);
});

test('filesToEntries warns on non-string leaves and bad files', () => {
  const pattern = parsePattern('messages/{locale}.json');
  const { entries: parsed, warnings } = filesToEntries(
    [
      { path: 'messages/en.json', content: '{"a":{"b":"ok","c":[1]}}' },
      { path: 'messages/de.json', content: 'broken{' },
    ],
    pattern,
    'en',
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.key, 'a.b');
  assert.equal(warnings.length, 2); // one skipped leaf + one parse failure
});
