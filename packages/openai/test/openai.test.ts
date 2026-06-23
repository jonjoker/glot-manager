import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranslatorError, type TranslationJob } from '@glot-manager/core';
import {
  createOpenAITranslator,
  DEFAULT_OPENAI_MODEL,
  type OpenAIChatCreateParams,
  type OpenAIClientLike,
} from '../src/index.ts';

function fakeClient(responder: (params: OpenAIChatCreateParams) => string | null): {
  client: OpenAIClientLike;
  calls: OpenAIChatCreateParams[];
} {
  const calls: OpenAIChatCreateParams[] = [];
  const client: OpenAIClientLike = {
    chat: {
      completions: {
        async create(params) {
          calls.push(params);
          return { choices: [{ message: { content: responder(params) } }] };
        },
      },
    },
  };
  return { client, calls };
}

const job: TranslationJob = {
  sourceLocale: 'en',
  sourceText: 'Welcome back',
  targetLocales: ['de', 'fr'],
};

test('translates and returns the parsed values', async () => {
  const { client, calls } = fakeClient(() =>
    JSON.stringify({ de: 'Willkommen zurück', fr: 'Bon retour' }),
  );
  const translator = createOpenAITranslator({ client });
  const result = await translator.translate(job);

  assert.equal(result.de, 'Willkommen zurück');
  assert.equal(result.fr, 'Bon retour');
  assert.equal(calls[0]?.model, DEFAULT_OPENAI_MODEL);
});

test('sends system + user messages and a strict json_schema response format', async () => {
  const { client, calls } = fakeClient(() => JSON.stringify({ de: 'x', fr: 'y' }));
  const translator = createOpenAITranslator({ client });
  await translator.translate(job);

  const params = calls[0]!;
  assert.equal(params.messages[0]?.role, 'system');
  assert.equal(params.messages[1]?.role, 'user');
  assert.match(params.messages[1]!.content, /Welcome back/);
  const rf = params.response_format as {
    type: string;
    json_schema: { strict: boolean; schema: { required: string[] } };
  };
  assert.equal(rf.type, 'json_schema');
  assert.equal(rf.json_schema.strict, true);
  assert.deepEqual(rf.json_schema.schema.required, ['de', 'fr']);
});

test('falls back to json_object format when structuredOutput is disabled', async () => {
  const { client, calls } = fakeClient(() => JSON.stringify({ de: 'x', fr: 'y' }));
  const translator = createOpenAITranslator({ client, structuredOutput: false });
  await translator.translate(job);
  assert.deepEqual(calls[0]?.response_format, { type: 'json_object' });
});

test('throws TranslatorError on an empty completion', async () => {
  const { client } = fakeClient(() => null);
  const translator = createOpenAITranslator({ client });
  await assert.rejects(() => translator.translate(job), /empty completion/);
});

test('wraps SDK errors in TranslatorError', async () => {
  const client: OpenAIClientLike = {
    chat: {
      completions: {
        async create() {
          throw new Error('500 server error');
        },
      },
    },
  };
  const translator = createOpenAITranslator({ client });
  await assert.rejects(() => translator.translate(job), TranslatorError);
});
