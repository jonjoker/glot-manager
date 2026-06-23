import { MemoryStore, createEchoTranslator, type Translator } from '@glot-manager/core';
import { createGlotHandler, silentLogger, type GlotServerConfig } from '../src/index.ts';

export interface HarnessOptions extends Partial<GlotServerConfig> {
  admin?: boolean;
}

export function buildHandler(options: HarnessOptions = {}) {
  const { admin = true, ...overrides } = options;
  const onChangeKeys: string[][] = [];

  const store =
    overrides.store ??
    new MemoryStore(
      { 'app.title': { values: { en: 'Dashboard', de: 'Übersicht' }, sourceLocale: 'en' } },
      { now: () => '2026-01-01T00:00:00.000Z' },
    );

  const handler = createGlotHandler({
    store,
    locales: { locales: ['en', 'de', 'fr', 'it'], defaultLocale: 'en' },
    authorize: overrides.authorize ?? (() => (admin ? { userId: 'admin-1' } : false)),
    translator: 'translator' in overrides ? overrides.translator : createEchoTranslator(),
    editableKeyPrefixes: overrides.editableKeyPrefixes ?? ['app', 'ui'],
    logger: overrides.logger ?? silentLogger,
    onChange: overrides.onChange ?? ((keys) => void onChangeKeys.push(keys)),
    ...overrides,
  });

  return { handler, store: store as MemoryStore, onChangeKeys };
}

const BASE = 'http://localhost/api/glot';

export function get(path: string): Request {
  return new Request(`${BASE}${path}`, {
    method: 'GET',
    headers: { origin: 'http://localhost' },
  });
}

export function mutate(method: 'PUT' | 'POST', path: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(body),
  });
}

export const noTranslator: { translator: Translator | undefined } = { translator: undefined };
