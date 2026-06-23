'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { GlotProvider } from '@glot-manager/react';

export function Providers({
  locale,
  messages,
  isAdmin,
  children,
}: {
  locale: string;
  messages: Record<string, string>;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <GlotProvider
      locale={locale}
      messages={messages}
      isAdmin={isAdmin}
      onSaved={() => router.refresh()}
    >
      {children}
    </GlotProvider>
  );
}
