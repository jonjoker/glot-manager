import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHandler } from './helpers.ts';

const BASE = 'http://localhost/api/glot';

test('blocks cross-site mutations (CSRF)', async () => {
  const { handler } = buildHandler();
  const res = await handler(
    new Request(`${BASE}/entries/app.title`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
        origin: 'http://evil.example',
      },
      body: JSON.stringify({ sourceLocale: 'en', values: { en: 'x' } }),
    }),
  );
  assert.equal(res.status, 403);
});

test('rejects a foreign Origin even without Sec-Fetch-Site', async () => {
  const { handler } = buildHandler();
  const res = await handler(
    new Request(`${BASE}/entries/app.title`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ sourceLocale: 'en', values: { en: 'x' } }),
    }),
  );
  assert.equal(res.status, 403);
});

test('allows a foreign Origin when it is in allowedOrigins', async () => {
  const { handler } = buildHandler({ allowedOrigins: ['http://trusted.example'] });
  const res = await handler(
    new Request(`${BASE}/entries/app.title`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://trusted.example',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ sourceLocale: 'en', values: { en: 'x' } }),
    }),
  );
  assert.equal(res.status, 200);
});

test('requires application/json content-type for mutations', async () => {
  const { handler } = buildHandler();
  const res = await handler(
    new Request(`${BASE}/entries/app.title`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', origin: 'http://localhost' },
      body: 'x',
    }),
  );
  assert.equal(res.status, 400);
});

test('disableCsrfProtection turns the checks off', async () => {
  const { handler } = buildHandler({ disableCsrfProtection: true });
  const res = await handler(
    new Request(`${BASE}/entries/app.title`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ sourceLocale: 'en', values: { en: 'x' } }),
    }),
  );
  assert.equal(res.status, 200);
});

test('rate limiter returns 429 with Retry-After', async () => {
  const { handler } = buildHandler({
    rateLimit: () => ({ ok: false, retryAfterSeconds: 42 }),
  });
  const res = await handler(
    new Request(`${BASE}/entries`, { method: 'GET', headers: { origin: 'http://localhost' } }),
  );
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '42');
});
