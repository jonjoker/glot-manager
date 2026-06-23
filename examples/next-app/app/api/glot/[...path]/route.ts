import { createGlotHandler } from '@glot-manager/server';
import { toNextHandler } from '@glot-manager/server/next';
import { createEchoTranslator } from '@glot-manager/core';
import { createAnthropicTranslator } from '@glot-manager/anthropic';
import { revalidatePath } from 'next/cache';
import { store, locales, translationContext } from '@/lib/glot';

// Use Claude when a key is present; otherwise fall back to the offline echo
// translator so the demo runs with zero configuration.
const translator = process.env.ANTHROPIC_API_KEY
  ? createAnthropicTranslator({ model: 'claude-sonnet-4-6' })
  : createEchoTranslator();

const handler = createGlotHandler({
  store,
  locales,
  translator,
  context: translationContext,
  editableKeyPrefixes: ['home', 'nav', 'cta', 'footer'],
  // Re-render pages after a save so edits go live immediately.
  onChange: () => revalidatePath('/'),
  // ⚠️ DEMO ONLY: every visitor is treated as an admin so you can try edit mode.
  // In production, read your session/JWT here and return `false` for non-admins:
  //   authorize: async (req) => (await getSession(req))?.role === 'admin',
  authorize: () => true,
});

export const { GET, PUT, POST } = toNextHandler(handler);
