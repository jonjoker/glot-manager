import type { TranslationUsage } from '@glot-manager/core';

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\\]]/g, '\\$&');
}

/**
 * Scan the live DOM for every element that renders a key (`[data-glot-key]`)
 * and read its `data-glot-usage-*` attributes. These are "exact" usages — they
 * reflect what is actually on screen right now — and overlay the server's
 * static usage manifest.
 */
export function getMountedUsages(key: string): TranslationUsage[] {
  if (typeof document === 'undefined') return [];
  const nodes = document.querySelectorAll<HTMLElement>(`[data-glot-key="${cssEscape(key)}"]`);
  return Array.from(nodes).map((el, index) => {
    const usage: TranslationUsage = {
      id: el.dataset.glotUsageId ?? `dom-${index}`,
      label: el.dataset.glotUsageLabel ?? 'On this page',
      exact: true,
    };
    if (el.dataset.glotUsageRoute) usage.route = el.dataset.glotUsageRoute;
    if (el.dataset.glotUsageSubitem) usage.subItem = el.dataset.glotUsageSubitem;
    if (el.dataset.glotUsageNotes) usage.notes = el.dataset.glotUsageNotes;
    return usage;
  });
}

/** Find a DOM element for a key/usage, preferring the exact usage id. */
export function findUsageElement(key: string, usageId?: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (usageId) {
    const byUsage = document.querySelector<HTMLElement>(
      `[data-glot-usage-id="${cssEscape(usageId)}"]`,
    );
    if (byUsage) return byUsage;
  }
  return document.querySelector<HTMLElement>(`[data-glot-key="${cssEscape(key)}"]`);
}
