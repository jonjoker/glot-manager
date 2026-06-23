import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeGlossaries,
  renderGlossary,
  selectRelevantGlossary,
  termAppearsIn,
  type GlossaryTerm,
} from '../src/index.ts';

const glossary: GlossaryTerm[] = [
  { term: 'curtailment', translations: { de: 'Abregelung', fr: 'écrêtage' } },
  { term: 'PV', doNotTranslate: true },
  { term: 'grid', description: 'the electricity network', translations: { de: 'Netz' } },
];

test('termAppearsIn matches whole words, case-insensitive by default', () => {
  assert.ok(termAppearsIn(glossary[0]!, 'Avoid curtailment of PV plants'));
  assert.ok(!termAppearsIn(glossary[0]!, 'curtailments are different')); // boundary
  assert.ok(termAppearsIn({ term: 'PV', caseSensitive: true }, 'a PV plant'));
  assert.ok(!termAppearsIn({ term: 'PV', caseSensitive: true }, 'a pv plant'));
});

test('selectRelevantGlossary returns only terms present in the text', () => {
  const hits = selectRelevantGlossary('Reduce curtailment on the grid', glossary);
  assert.deepEqual(hits.map((t) => t.term).sort(), ['curtailment', 'grid']);
});

test('renderGlossary emits approved translations and do-not-translate notes', () => {
  const rendered = renderGlossary(glossary, ['de', 'fr']);
  assert.match(rendered, /curtailment/);
  assert.match(rendered, /de="Abregelung"/);
  assert.match(rendered, /fr="écrêtage"/);
  assert.match(rendered, /"PV": keep untranslated/);
});

test('renderGlossary returns empty string for no terms', () => {
  assert.equal(renderGlossary([], ['de']), '');
});

test('mergeGlossaries de-dupes by term with override winning', () => {
  const merged = mergeGlossaries(
    [{ term: 'grid', translations: { de: 'Netz' } }],
    [{ term: 'grid', translations: { de: 'Stromnetz' } }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.translations?.de, 'Stromnetz');
});

test('mergeGlossaries keeps a case-sensitive term distinct from a lowercase one', () => {
  const merged = mergeGlossaries(
    [{ term: 'IT', caseSensitive: true, doNotTranslate: true }],
    [{ term: 'it', translations: { de: 'es' } }],
  );
  assert.equal(merged.length, 2);
  assert.ok(merged.some((t) => t.term === 'IT' && t.doNotTranslate));
});
