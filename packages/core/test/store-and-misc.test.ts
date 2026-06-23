import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryStore,
  auditEntries,
  buildLocaleNames,
  localeDisplayName,
  mergeContext,
  mergeUsages,
  mergeValues,
  normalizeLocaleConfig,
  normalizeUpsertInput,
  resolveContext,
  targetLocalesFor,
  type TranslationJob,
} from '../src/index.ts';

test('MemoryStore seeds, lists, gets, and merges on upsert', async () => {
  const store = new MemoryStore({
    'app.title': { values: { en: 'Dashboard', de: 'Übersicht' } },
  });
  assert.equal(store.size, 1);

  const entry = await store.get('app.title');
  assert.equal(entry?.values.de, 'Übersicht');
  assert.equal(entry?.namespace, 'app');

  await store.upsert({ key: 'app.title', values: { fr: 'Tableau' }, sourceLocale: 'en' });
  const updated = await store.get('app.title');
  assert.equal(updated?.values.en, 'Dashboard'); // preserved
  assert.equal(updated?.values.fr, 'Tableau'); // added

  const all = await store.list();
  assert.equal(all.length, 1);
  const subset = await store.list(['missing.key']);
  assert.equal(subset.length, 0);
});

test('MemoryStore returns copies (no external mutation)', async () => {
  const store = new MemoryStore({ 'a.b': { values: { en: 'x' } } });
  const entry = await store.get('a.b');
  entry!.values.en = 'mutated';
  const again = await store.get('a.b');
  assert.equal(again?.values.en, 'x');
});

test('normalizeUpsertInput derives namespace and drops unknown locales', () => {
  const normalized = normalizeUpsertInput(
    { key: 'a.b.c', values: { en: 'x', xx: 'y' }, sourceLocale: 'en' },
    ['en', 'de'],
  );
  assert.equal(normalized.namespace, 'a.b');
  assert.deepEqual(normalized.values, { en: 'x' });
});

test('mergeValues and targetLocalesFor', () => {
  assert.deepEqual(mergeValues({ en: 'a', de: 'b' }, { de: 'c' }), { en: 'a', de: 'c' });
  assert.deepEqual(targetLocalesFor('en', ['en', 'de', 'fr']), ['de', 'fr']);
});

test('localeDisplayName falls back gracefully', () => {
  assert.equal(localeDisplayName('de', { de: 'Custom' }), 'Custom');
  assert.equal(typeof localeDisplayName('de'), 'string');
  assert.equal(localeDisplayName('zz-ZZ'), 'zz-ZZ');
});

test('buildLocaleNames and normalizeLocaleConfig', () => {
  const names = buildLocaleNames({ locales: ['en', 'de'], defaultLocale: 'en' });
  assert.ok(names.en && names.de);
  assert.throws(() => normalizeLocaleConfig({ locales: [], defaultLocale: 'en' }));
  assert.throws(() => normalizeLocaleConfig({ locales: ['en'], defaultLocale: 'de' }));
  const ok = normalizeLocaleConfig({ locales: ['en', 'en', 'de'], defaultLocale: 'en' });
  assert.deepEqual(ok.locales, ['en', 'de']);
});

test('mergeUsages dedupes and lets exact (DOM) usages win', () => {
  const merged = mergeUsages(
    [{ id: 'u1', label: 'Title', route: 'Home' }],
    [{ id: 'u1', label: 'Title', route: 'Home', exact: true, notes: 'live' }],
    [{ id: 'u2', label: 'Other' }],
  );
  assert.equal(merged.length, 2);
  const u1 = merged.find((u) => u.id === 'u1');
  assert.equal(u1?.exact, true);
  assert.equal(u1?.notes, 'live');
});

test('mergeContext concatenates glossaries and shallow-merges tone/metadata', () => {
  const merged = mergeContext(
    { domain: 'energy', glossary: [{ term: 'grid' }], tone: { de: 'formal' } },
    { glossary: [{ term: 'curtailment' }], tone: { fr: 'casual' }, styleGuide: 'crisp' },
  );
  assert.equal(merged.domain, 'energy');
  assert.equal(merged.styleGuide, 'crisp');
  assert.equal(merged.glossary?.length, 2);
  assert.deepEqual(merged.tone, { de: 'formal', fr: 'casual' });
});

test('resolveContext merges static + job + dynamic provider', async () => {
  const job: TranslationJob = {
    sourceLocale: 'en',
    sourceText: 'x',
    targetLocales: ['de'],
    context: { instructions: 'from job' },
  };
  const resolved = await resolveContext(job, { domain: 'static' }, async () => ({
    styleGuide: 'dynamic',
  }));
  assert.equal(resolved.domain, 'static');
  assert.equal(resolved.instructions, 'from job');
  assert.equal(resolved.styleGuide, 'dynamic');
});

test('auditEntries reports mismatches, missing locales, copies, and collisions', () => {
  const report = auditEntries(
    [
      {
        key: 'a.b',
        namespace: 'a',
        sourceLocale: 'en',
        values: { en: 'Save {count}', de: 'Speichern' /* missing {count} */, fr: '' },
      },
      { key: 'a', namespace: '', sourceLocale: 'en', values: { en: 'A', de: 'A' /* copy */ } },
    ],
    { locales: ['en', 'de', 'fr'] },
  );

  const codes = new Set(report.findings.map((f) => f.code));
  assert.ok(codes.has('token_mismatch'));
  assert.ok(codes.has('missing_locale'));
  assert.ok(codes.has('suspicious_copy'));
  assert.ok(codes.has('key_collision'));
  assert.equal(report.ok, false);
});
