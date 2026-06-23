import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { GlotProvider, T, useT } from '../src/index.ts';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/** A fetcher that answers the Glot Manager endpoints from an in-memory entry. */
function makeFetcher(initialValues: Record<string, string>) {
  const calls: FetchCall[] = [];
  let values = { ...initialValues };

  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });

    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (url.endsWith('/config')) {
      return json({
        locales: ['en', 'de', 'fr'],
        defaultLocale: 'en',
        localeNames: { en: 'English', de: 'Deutsch', fr: 'Français' },
        autoTranslate: true,
      });
    }
    if (url.includes('/entries/') && url.endsWith('/translate')) {
      return json({ values: { ...body.values, de: 'Auto-DE', fr: 'Auto-FR' } });
    }
    if (url.includes('/entries/') && method === 'GET') {
      return json({
        entry: {
          key: 'home.title',
          namespace: 'home',
          values,
          sourceLocale: 'en',
          usages: [{ id: 'u1', label: 'Page title', route: 'Home' }],
        },
      });
    }
    if (url.includes('/entries/') && method === 'PUT') {
      values = { ...values, ...body.values };
      return json({
        entry: {
          key: 'home.title',
          namespace: 'home',
          values,
          sourceLocale: body.sourceLocale,
          usages: [],
        },
      });
    }
    return json({ error: { code: 'not_found', message: 'no' } }, 404);
  });

  return { fetcher, calls };
}

function Harness({
  children,
  isAdmin = false,
  editMode = false,
  fetcher,
}: {
  children: ReactNode;
  isAdmin?: boolean;
  editMode?: boolean;
  fetcher?: typeof fetch;
}) {
  return (
    <GlotProvider
      locale="en"
      messages={{ 'home.title': 'Welcome' }}
      isAdmin={isAdmin}
      defaultEditMode={editMode}
      persist={false}
      {...(fetcher ? { fetcher } : {})}
    >
      {children}
    </GlotProvider>
  );
}

describe('<T>', () => {
  test('resolves a message and renders no wrapper when not editing', () => {
    const { container } = render(
      <Harness>
        <T id="home.title">Fallback</T>
      </Harness>,
    );
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(container.querySelector('[data-glot-key]')).toBeNull();
  });

  test('falls back to children (source text) when no message exists', () => {
    render(
      <Harness>
        <T id="missing.key">Readable fallback</T>
      </Harness>,
    );
    expect(screen.getByText('Readable fallback')).toBeInTheDocument();
  });

  test('renders an editable label for admins in edit mode', () => {
    const { container } = render(
      <Harness isAdmin editMode>
        <T id="home.title" usageLabel="Page title">
          Welcome
        </T>
      </Harness>,
    );
    const el = container.querySelector('[data-glot-key="home.title"]');
    expect(el).not.toBeNull();
    expect(el).toHaveClass('glot-editable');
    expect(el?.getAttribute('data-glot-usage-label')).toBe('Page title');
  });

  test('is not editable for non-admins even with edit mode requested', () => {
    const { container } = render(
      <Harness editMode>
        <T id="home.title">Welcome</T>
      </Harness>,
    );
    expect(container.querySelector('[data-glot-key]')).toBeNull();
  });
});

describe('editor dialog', () => {
  test('opens on click, loads the entry, and saves', async () => {
    const { fetcher, calls } = makeFetcher({ en: 'Welcome', de: 'Willkommen', fr: '' });
    const { container } = render(
      <Harness isAdmin editMode fetcher={fetcher}>
        <T id="home.title">Welcome</T>
      </Harness>,
    );

    fireEvent.click(container.querySelector('[data-glot-key="home.title"]')!);

    // Dialog (lazy chunk) loads and fetches the entry.
    expect(await screen.findByText('Edit translation')).toBeInTheDocument();
    const frField = (await screen.findByLabelText(/Français \(fr\)/)) as HTMLTextAreaElement;
    expect(frField).toBeInTheDocument();

    fireEvent.change(frField, { target: { value: 'Bienvenue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as { values: Record<string, string> }).values.fr).toBe('Bienvenue');

    // Dialog closes after save.
    await waitFor(() => {
      expect(screen.queryByText('Edit translation')).toBeNull();
    });
  });

  test('auto-translate fills target locales', async () => {
    const { fetcher, calls } = makeFetcher({ en: 'Welcome', de: '', fr: '' });
    const { container } = render(
      <Harness isAdmin editMode fetcher={fetcher}>
        <T id="home.title">Welcome</T>
      </Harness>,
    );
    fireEvent.click(container.querySelector('[data-glot-key="home.title"]')!);

    const translateBtn = await screen.findByRole('button', { name: /Translate from/ });
    fireEvent.click(translateBtn);

    const deField = (await screen.findByLabelText(/Deutsch \(de\)/)) as HTMLTextAreaElement;
    await waitFor(() => expect(deField.value).toBe('Auto-DE'));
    expect(calls.some((c) => c.url.endsWith('/translate'))).toBe(true);
  });
});

describe('useT', () => {
  test('returns a plain string', () => {
    let value = '';
    function Probe() {
      const t = useT();
      value = t('home.title', 'Fallback');
      return null;
    }
    render(
      <Harness>
        <Probe />
      </Harness>,
    );
    expect(value).toBe('Welcome');
  });
});
