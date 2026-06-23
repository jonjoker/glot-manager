import type { ReactNode } from 'react';
import type { Locale } from '@glot-manager/core';
import { useGlotContext } from './context.tsx';

export interface UseGlot {
  locale: Locale;
  isAdmin: boolean;
  editMode: boolean;
  /** `true` when labels are currently interactive. */
  interactive: boolean;
  setEditMode: (value: boolean) => void;
  toggleEditMode: () => void;
  /** Open the editor for a key programmatically (admins only). */
  openEditor: (key: string) => void;
}

/** Access Glot Manager state and controls (edit-mode toggle, programmatic open, …). */
export function useGlot(): UseGlot {
  const ctx = useGlotContext();
  return {
    locale: ctx.locale,
    isAdmin: ctx.isAdmin,
    editMode: ctx.editMode,
    interactive: ctx.interactive,
    setEditMode: ctx.setEditMode,
    toggleEditMode: ctx.toggleEditMode,
    openEditor: ctx.openEditor,
  };
}

/**
 * Resolve translation keys to plain strings — for places that need a string
 * rather than an element (e.g. `aria-label`, `title`, `placeholder`). Unlike
 * {@link T}, the result is not click-to-edit.
 *
 * @example
 * ```tsx
 * const t = useT();
 * <input aria-label={t('search.label', 'Search')} />
 * ```
 */
export function useT(): (id: string, fallback?: string) => string {
  const ctx = useGlotContext();
  return (id: string, fallback?: string): string => {
    const resolved: ReactNode = ctx.resolve(id, fallback ?? id);
    return typeof resolved === 'string' ? resolved : (fallback ?? id);
  };
}
