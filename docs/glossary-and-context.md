# Glossary & context — the extensible LLM call

The one thing every team's translations need that generic MT gets wrong:
**their** terminology, **their** voice, and the **context** of where a string
appears. Glot Manager makes this a first-class input to every LLM call via the
`TranslationContext`.

```ts
interface TranslationContext {
  domain?: string; // what the product is
  styleGuide?: string; // brand voice / "company language"
  tone?: Partial<Record<Locale, string>>; // per-locale tone overrides
  glossary?: GlossaryTerm[]; // approved terminology
  instructions?: string; // extra system instructions
  metadata?: Record<string, unknown>; // arbitrary structured context
}
```

## Static context

Pass it once to the handler:

```ts
createGlotHandler({
  // …
  context: {
    domain: 'energy management software for grid operators',
    styleGuide:
      'Formal and precise. Prefer industry-standard terms over plain language. No exclamation marks.',
    tone: { de: 'Use the formal "Sie".', fr: 'Use formal "vous".' },
    glossary: [
      {
        term: 'curtailment',
        description: 'reducing renewable output',
        translations: { de: 'Abregelung', fr: 'écrêtage' },
      },
      { term: 'PV', doNotTranslate: true },
      { term: 'grid', translations: { de: 'Netz' } },
    ],
    instructions: 'Match the source capitalization style exactly.',
  },
});
```

## Dynamic context (per request)

Load context at translation time — e.g. a per-tenant glossary from your database,
or hints derived from the key. The result is merged on top of the static context.

```ts
createGlotHandler({
  // …
  context: { domain: 'our SaaS' }, // base
  contextProvider: async (job) => ({
    glossary: await loadTenantGlossary(job.key),
    styleGuide: await loadBrandVoice(job.key),
  }),
});
```

Merge rules: scalar fields from the dynamic context win; glossaries are
concatenated and de-duplicated by term; `tone` and `metadata` are shallow-merged.

## Glossary terms

```ts
interface GlossaryTerm {
  term: string; // as written in the source
  description?: string; // disambiguation for the model
  translations?: Partial<Record<Locale, string>>; // approved renderings (used verbatim)
  doNotTranslate?: boolean; // keep untranslated everywhere
  caseSensitive?: boolean; // default false
}
```

Glot Manager scans each source string and injects **only the terms that appear in it**,
so the prompt stays small and focused even with a large termbase. A term with
`translations` instructs the model to use that rendering exactly; `doNotTranslate`
keeps brand names and acronyms intact.

## What the model receives

For a string like `Avoid curtailment of {plantName}`, with the context above, the
prompt includes:

- a system preamble with hard rules (preserve `{placeholders}`, ICU, `%s`,
  `<tags>`, whitespace, capitalization; return strict JSON),
- the product **domain** and **style guide**,
- the **glossary subset** that matched (`curtailment` → de "Abregelung", …),
- the **per-locale tone** (de: formal "Sie"),
- where the string is **used** (from the usage registry + live DOM),
- and the exact target locales to return.

## Validation

The returned translation is checked so the glossary and markup actually hold up:
every target must keep the source's placeholders/ICU/tags and must not be an
accidental copy of the source. Problems surface as non-blocking `issues` for the
editor to review before saving.

See also: [Providers](./providers.md) for replacing the prompt builder or the
whole translator.
