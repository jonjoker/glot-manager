import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranslationPrompt, type TranslationJob } from '../src/index.ts';

const baseJob: TranslationJob = {
  key: 'app.cta.save',
  sourceLocale: 'en',
  sourceText: 'Save {count} changes',
  targetLocales: ['de', 'fr'],
  localeNames: { en: 'English', de: 'Deutsch', fr: 'Français' },
};

test('default prompt instructs to preserve placeholders and return JSON', () => {
  const prompt = buildTranslationPrompt(baseJob);
  assert.match(prompt.system, /placeholder/i);
  assert.match(prompt.user, /Save \{count\} changes/);
  assert.match(prompt.user, /JSON object/i);
  assert.deepEqual(prompt.expectedKeys, ['de', 'fr']);
});

test('prompt injects domain, style guide, glossary, usages, and tone', () => {
  const prompt = buildTranslationPrompt({
    ...baseJob,
    usages: [{ id: 'u1', label: 'Button label', route: 'Checkout' }],
    context: {
      domain: 'energy management software',
      styleGuide: 'Friendly but precise.',
      tone: { de: "Use the formal 'Sie'." },
      glossary: [{ term: 'changes', translations: { de: 'Änderungen' } }],
      instructions: 'Never use exclamation marks.',
      metadata: { audience: 'grid operators' },
    },
  });

  assert.match(prompt.system, /energy management software/);
  assert.match(prompt.system, /Friendly but precise/);
  assert.match(prompt.system, /Never use exclamation marks/);
  assert.match(prompt.user, /Button label/);
  assert.match(prompt.user, /Änderungen/);
  assert.match(prompt.user, /formal 'Sie'/);
  assert.match(prompt.user, /grid operators/);
});

test('custom system preamble replaces the default but JSON instruction remains', () => {
  const prompt = buildTranslationPrompt(baseJob, { system: 'CUSTOM PREAMBLE' });
  assert.match(prompt.system, /CUSTOM PREAMBLE/);
  assert.doesNotMatch(prompt.system, /professional software localization engine/);
  assert.match(prompt.user, /Return ONLY a JSON object/);
});

test('extraInstructions are appended to the system prompt', () => {
  const prompt = buildTranslationPrompt(baseJob, { extraInstructions: 'Prefer short words.' });
  assert.match(prompt.system, /Prefer short words/);
});
