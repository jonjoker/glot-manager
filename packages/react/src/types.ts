import type { ReactNode } from 'react';
import type { EditableEntry, Locale } from '@glot-manager/core';

/** Flat or nested message map for the current locale (both are supported). */
export type Messages = Record<string, unknown>;

/** Usage metadata attached to an editable label (rendered as `data-glot-*`). */
export interface UsageMeta {
  usageId?: string;
  usageLabel?: string;
  usageRoute?: string;
  usageSubItem?: string;
  usageNotes?: string;
}

export interface GlotProviderProps extends UsageProviderConfig {
  /** Base path the server handler is mounted under. Default `/api/glot`. */
  endpoint?: string;
  /** The current display locale. */
  locale: Locale;
  /**
   * Messages for the current locale (flat `{ "a.b": "text" }` or nested). When
   * provided, `<T>`/`useT` resolve text from here; otherwise they render the
   * `children`/fallback you pass. Always optional.
   */
  messages?: Messages;
  /**
   * Whether the current user may edit. Edit mode only activates for admins.
   * The server independently re-checks authorization on every write.
   */
  isAdmin?: boolean;
  /** Initial edit-mode state (admins only). Default `false`. */
  defaultEditMode?: boolean;
  /** Persist the edit-mode toggle in `localStorage`. Default `true`. */
  persist?: boolean;
  /** `localStorage` key for the toggle. Default `glot:edit-mode`. */
  storageKey?: string;
  /** Custom fetch (e.g. to add auth headers). Defaults to global `fetch`. */
  fetcher?: typeof fetch;
  /** Called after a successful save (e.g. `() => router.refresh()`). */
  onSaved?: (entry: EditableEntry) => void;
  /** Called when a "Used in" target lives on another page. */
  onNavigate?: (route: string) => void;
  children: ReactNode;
}

interface UsageProviderConfig {
  /**
   * Hold a modifier key to reveal editable labels (in addition to the toggle).
   * Set to `false` to disable. Default `'Alt'`.
   */
  revealKey?: 'Alt' | 'Control' | 'Meta' | 'Shift' | false;
}
