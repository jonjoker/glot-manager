import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranslatorError, UnauthorizedError } from '@glot-manager/core';
import { buildHandler, get, mutate } from './helpers.ts';

async function jsonOf(response: Response): Promise<any> {
  return JSON.parse(await response.text());
}

test('GET /config returns locales and the auto-translate flag', async () => {
  const { handler } = buildHandler();
  const res = await handler(get('/config'));
  assert.equal(res.status, 200);
  const body = await jsonOf(res);
  assert.deepEqual(body.locales, ['en', 'de', 'fr', 'it']);
  assert.equal(body.defaultLocale, 'en');
  assert.equal(body.autoTranslate, true);
  assert.ok(body.localeNames.de);
});

test('GET /config reports autoTranslate:false when no translator', async () => {
  const { handler } = buildHandler({ translator: undefined });
  const body = await jsonOf(await handler(get('/config')));
  assert.equal(body.autoTranslate, false);
});

test('GET /entries lists stored entries with usages', async () => {
  const { handler } = buildHandler();
  const body = await jsonOf(await handler(get('/entries')));
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].key, 'app.title');
  assert.ok(Array.isArray(body.entries[0].usages));
});

test('GET /entries/:key returns an empty editable entry for an unknown (but editable) key', async () => {
  const { handler } = buildHandler();
  const body = await jsonOf(await handler(get('/entries/app.newKey')));
  assert.equal(body.entry.key, 'app.newKey');
  assert.deepEqual(body.entry.values, {});
  assert.equal(body.entry.namespace, 'app');
});

test('PUT /entries/:key saves, records updatedBy, and fires onChange', async () => {
  const { handler, store, onChangeKeys } = buildHandler();
  const res = await handler(
    mutate('PUT', '/entries/app.title', {
      sourceLocale: 'en',
      values: { en: 'Home', de: 'Startseite', fr: 'Accueil', it: 'Home' },
    }),
  );
  assert.equal(res.status, 200);
  const body = await jsonOf(res);
  assert.equal(body.entry.values.de, 'Startseite');
  assert.equal(body.entry.updatedBy, 'admin-1');

  const stored = await store.get('app.title');
  assert.equal(stored?.values.fr, 'Accueil');
  assert.deepEqual(onChangeKeys, [['app.title']]);
});

test('PUT rejects a non-editable key with 400', async () => {
  const { handler } = buildHandler();
  const res = await handler(
    mutate('PUT', '/entries/secret.flag', { sourceLocale: 'en', values: { en: 'x' } }),
  );
  assert.equal(res.status, 400);
  const body = await jsonOf(res);
  assert.equal(body.error.code, 'bad_request');
});

test('PUT drops values for unknown locales', async () => {
  const { handler, store } = buildHandler();
  await handler(
    mutate('PUT', '/entries/app.title', {
      sourceLocale: 'en',
      values: { en: 'Home', xx: 'nope' },
    }),
  );
  const stored = await store.get('app.title');
  assert.equal(stored?.values.en, 'Home');
  assert.equal((stored?.values as Record<string, string>).xx, undefined);
});

test('rejects unauthorized requests with 403', async () => {
  const { handler } = buildHandler({ admin: false });
  const res = await handler(get('/entries'));
  assert.equal(res.status, 403);
});

test('authorizer can throw UnauthorizedError for a 401', async () => {
  const { handler } = buildHandler({
    authorize: () => {
      throw new UnauthorizedError();
    },
  });
  const res = await handler(get('/entries'));
  assert.equal(res.status, 401);
});

test('returns 405 with an Allow header for the wrong method', async () => {
  const { handler } = buildHandler();
  const res = await handler(new Request('http://localhost/api/glot/config', { method: 'DELETE' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET');
});

test('returns 404 for unknown endpoints', async () => {
  const { handler } = buildHandler();
  assert.equal((await handler(get('/nope'))).status, 404);
  assert.equal((await handler(get('/entries/app.x/bogus'))).status, 404);
});

test('POST /entries/:key/translate fills every target locale', async () => {
  const { handler } = buildHandler();
  const res = await handler(
    mutate('POST', '/entries/app.title/translate', {
      sourceLocale: 'en',
      values: { en: 'Save {count} changes' },
    }),
  );
  assert.equal(res.status, 200);
  const body = await jsonOf(res);
  assert.equal(body.values.en, 'Save {count} changes');
  assert.equal(body.values.de, '[de] Save {count} changes');
  assert.equal(body.values.fr, '[fr] Save {count} changes');
  assert.equal(body.values.it, '[it] Save {count} changes');
});

test('translate returns 501 when no translator is configured', async () => {
  const { handler } = buildHandler({ translator: undefined });
  const res = await handler(
    mutate('POST', '/entries/app.title/translate', {
      sourceLocale: 'en',
      values: { en: 'Hi' },
    }),
  );
  assert.equal(res.status, 501);
});

test('translate rejects empty source text with 400', async () => {
  const { handler } = buildHandler();
  const res = await handler(
    mutate('POST', '/entries/app.title/translate', { sourceLocale: 'en', values: { en: '  ' } }),
  );
  assert.equal(res.status, 400);
});

test('rejects non-string values with 400 (no "[object Object]" coercion)', async () => {
  const { handler, store } = buildHandler();
  const res = await handler(
    mutate('PUT', '/entries/app.title', {
      sourceLocale: 'en',
      values: { en: { nested: 1 } },
    }),
  );
  assert.equal(res.status, 400);
  const stored = await store.get('app.title');
  assert.notEqual(stored?.values.en, '[object Object]');
});

test('5xx translator failures do not leak the upstream error message', async () => {
  const { handler } = buildHandler({
    translator: {
      id: 'boom',
      async translate() {
        throw new TranslatorError('SECRET upstream billing detail');
      },
    },
  });
  const res = await handler(
    mutate('POST', '/entries/app.title/translate', { sourceLocale: 'en', values: { en: 'Hi' } }),
  );
  assert.equal(res.status, 502);
  const body = await jsonOf(res);
  assert.equal(body.error.message, 'The translation provider failed');
  assert.doesNotMatch(JSON.stringify(body), /SECRET/);
});

test('invalid JSON body yields 400', async () => {
  const { handler } = buildHandler();
  const res = await handler(
    new Request('http://localhost/api/glot/entries/app.title', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        'sec-fetch-site': 'same-origin',
      },
      body: '{not json',
    }),
  );
  assert.equal(res.status, 400);
});
