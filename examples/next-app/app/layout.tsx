import type { ReactNode } from 'react';
import { Providers } from './providers';
import { locales, messagesFor } from '@/lib/glot';

export const metadata = {
  title: 'Glot Manager · Next.js example',
  description: 'In-context, AI-native translation editing.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = locales.defaultLocale;
  const messages = await messagesFor(locale);

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          color: '#0f172a',
          background: '#f8fafc',
        }}
      >
        {/* In a real app, `isAdmin` comes from your auth/session. */}
        <Providers locale={locale} messages={messages} isAdmin>
          {children}
        </Providers>
      </body>
    </html>
  );
}
