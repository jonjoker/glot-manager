import type { TranslationUsage } from '@glot-manager/core';
import { findUsageElement } from './dom-usage.ts';

/**
 * Scroll a key's usage into view and flash a temporary ring around it.
 * Returns `false` if the element isn't on the current page.
 */
export function scrollToUsage(key: string, usage: TranslationUsage): boolean {
  const el = findUsageElement(key, usage.id);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('glot-ring');
  window.setTimeout(() => el.classList.remove('glot-ring'), 2500);
  return true;
}
