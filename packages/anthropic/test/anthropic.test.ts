import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranslatorError, type TranslationJob } from '@glot-manager/core';
import {
  createAnthropicTranslator,
  DEFAULT_ANTHROPIC_MODEL,
  type AnthropicClientLike,
  type AnthropicMessagesCreateParams,
} from '../src/index.ts';

function fakeClient(responder: (params: AnthropicMessagesCreateParams) => string): {
  client: AnthropicClientLike;
  calls: AnthropicMessagesCreateParams[];
} {
  const calls: AnthropicMessagesCreateParams[] = [];
  const client: AnthropicClientLike = {
    messages: {
      async create(params) {
        calls.push(params);
        return { content: [{ type: 'text', text: responder(params) }] };
      },
    },
  };
  return { client, calls };
}

const job: TranslationJob = {
  key: 'app.cta',
  sourceLocale: 'en',
  sourceText: 'Save {count} changes',
  targetLocales: ['de', 'fr'],
  context: { glossary: [{ term: 'changes', translations: { de: 'Änderungen' } }] },
};

test('translates and returns the parsed values', async () => {
  const { client, calls } = fakeClient(() =>
    JSON.stringify({ de: 'Speichere {count} Änderungen', fr: 'Enregistrer {count} modifications' }),
  );
  const translator = createAnthropicTranslator({ client });
  const result = await translator.translate(job);

  assert.equal(result.de, 'Speichere {count} Änderungen');
  assert.equal(result.fr, 'Enregistrer {count} modifications');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.model, DEFAULT_ANTHROPIC_MODEL);
});

test('passes the built system prompt, user payload, and JSON schema', async () => {
  const { client, calls } = fakeClient(() => JSON.stringify({ de: 'x', fr: 'y' }));
  const translator = createAnthropicTranslator({ client });
  await translator.translate(job);

  const params = calls[0]!;
  assert.match(params.system ?? '', /localization engine/i);
  assert.match(params.messages[0]!.content, /Save \{count\} changes/);
  assert.match(params.messages[0]!.content, /Änderungen/); // glossary injected
  const format = (params.output_config as { format: { schema: { required: string[] } } }).format;
  assert.deepEqual(format.schema.required, ['de', 'fr']);
});

test('merges extraCreateParams.output_config without dropping the json schema', async () => {
  const { client, calls } = fakeClient(() => JSON.stringify({ de: 'x', fr: 'y' }));
  const translator = createAnthropicTranslator({
    client,
    model: 'claude-sonnet-4-6',
    extraCreateParams: { output_config: { effort: 'low' } },
  });
  await translator.translate(job);
  assert.equal(calls[0]?.model, 'claude-sonnet-4-6');
  // The user's effort is preserved AND the structured-output format is still set.
  const oc = calls[0]?.output_config as { effort: string; format: { schema: unknown } };
  assert.equal(oc.effort, 'low');
  assert.ok(oc.format, 'structured-output format must survive extraCreateParams');
});

test('supports a custom prompt builder', async () => {
  const { client, calls } = fakeClient(() => JSON.stringify({ de: 'x', fr: 'y' }));
  const translator = createAnthropicTranslator({
    client,
    buildPrompt: (j) => ({
      system: 'CUSTOM',
      user: `translate ${j.sourceText}`,
      expectedKeys: j.targetLocales,
    }),
  });
  await translator.translate(job);
  assert.equal(calls[0]?.system, 'CUSTOM');
  assert.match(calls[0]!.messages[0]!.content, /^translate /);
});

test('wraps SDK errors in TranslatorError', async () => {
  const client: AnthropicClientLike = {
    messages: {
      async create() {
        throw new Error('429 rate limited');
      },
    },
  };
  const translator = createAnthropicTranslator({ client });
  await assert.rejects(() => translator.translate(job), TranslatorError);
});

test('throws TranslatorError when the model omits a target locale', async () => {
  const { client } = fakeClient(() => JSON.stringify({ de: 'only german' }));
  const translator = createAnthropicTranslator({ client });
  await assert.rejects(() => translator.translate(job), /missing string values for: fr/);
});

test('throws a clear error when no API key is configured', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const translator = createAnthropicTranslator();
    await assert.rejects(() => translator.translate(job), /API key missing/);
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});
