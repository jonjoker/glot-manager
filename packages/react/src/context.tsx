import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ConfigResponse, EditableEntry, Locale, TranslationUsage } from '@glot-manager/core';
import { GlotClient } from './client.ts';
import { ensureStyles } from './styles.ts';
import { readFlag, writeFlag } from './storage.ts';
import { scrollToUsage } from './navigation.ts';
import type { GlotProviderProps, Messages } from './types.ts';

const EditorDialog = lazy(() => import('./editor/dialog.tsx'));

export interface GlotContextValue {
  locale: Locale;
  isAdmin: boolean;
  editMode: boolean;
  /** `true` when labels should be interactive (edit mode on, or modifier held). */
  interactive: boolean;
  setEditMode: (value: boolean) => void;
  toggleEditMode: () => void;
  config: ConfigResponse | null;
  client: GlotClient;
  resolve: (id: string | undefined, fallback: ReactNode) => ReactNode;
  activeKey: string | null;
  openEditor: (key: string) => void;
  closeEditor: () => void;
  applyLocalUpdate: (key: string, value: string) => void;
  navigateToUsage: (key: string, usage: TranslationUsage) => void;
}

const GlotContext = createContext<GlotContextValue | null>(null);

export function useGlotContext(): GlotContextValue {
  const ctx = useContext(GlotContext);
  if (!ctx) throw new Error('Glot Manager components must be used inside <GlotProvider>');
  return ctx;
}

function lookup(messages: Messages | undefined, id: string): string | undefined {
  if (!messages) return undefined;
  const flat = messages[id];
  if (typeof flat === 'string') return flat;
  let node: unknown = messages;
  for (const segment of id.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

export function GlotProvider(props: GlotProviderProps): ReactNode {
  const {
    endpoint,
    locale,
    messages,
    isAdmin = false,
    defaultEditMode = false,
    persist = true,
    storageKey = 'glot:edit-mode',
    fetcher,
    onSaved,
    onNavigate,
    revealKey = 'Alt',
    children,
  } = props;

  const [editMode, setEditModeState] = useState(defaultEditMode);
  const [revealActive, setRevealActive] = useState(false);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const client = useMemo(
    () => new GlotClient({ ...(endpoint ? { endpoint } : {}), ...(fetcher ? { fetcher } : {}) }),
    [endpoint, fetcher],
  );

  // Inject styles once, and hydrate the persisted toggle (admins only).
  useEffect(() => {
    ensureStyles();
    if (isAdmin && persist) {
      const stored = readFlag(storageKey);
      if (stored !== null) setEditModeState(stored);
    }
  }, [isAdmin, persist, storageKey]);

  const setEditMode = useCallback(
    (value: boolean) => {
      setEditModeState(value);
      if (persist) writeFlag(storageKey, value);
    },
    [persist, storageKey],
  );
  const toggleEditMode = useCallback(() => setEditMode(!editMode), [editMode, setEditMode]);

  const interactive = isAdmin && (editMode || revealActive);

  // Hold-to-reveal modifier (e.g. Alt) — admin only.
  useEffect(() => {
    if (!isAdmin || revealKey === false || typeof window === 'undefined') return;
    const down = (e: KeyboardEvent) => {
      if (e.key === revealKey) setRevealActive(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === revealKey) setRevealActive(false);
    };
    const blur = () => setRevealActive(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [isAdmin, revealKey]);

  // Load config once the editor is reachable.
  useEffect(() => {
    if (!interactive || config) return;
    let cancelled = false;
    client
      .getConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        /* surfaced when the dialog opens */
      });
    return () => {
      cancelled = true;
    };
  }, [interactive, config, client]);

  // Prefetch the editor chunk once edit mode is reachable, so the first click
  // opens instantly instead of waiting on a network round-trip for the JS.
  useEffect(() => {
    if (interactive) void import('./editor/dialog.tsx');
  }, [interactive]);

  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (navTimer.current) clearTimeout(navTimer.current);
    },
    [],
  );

  const resolve = useCallback(
    (id: string | undefined, fallback: ReactNode): ReactNode => {
      if (!id) return fallback;
      if (overrides[id] !== undefined) return overrides[id];
      const found = lookup(messages, id);
      return found !== undefined ? found : fallback;
    },
    [messages, overrides],
  );

  const openEditor = useCallback(
    (key: string) => {
      if (!isAdmin) return;
      setActiveKey(key);
    },
    [isAdmin],
  );
  const closeEditor = useCallback(() => setActiveKey(null), []);

  const applyLocalUpdate = useCallback((key: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  }, []);

  const navigateToUsage = useCallback(
    (key: string, usage: TranslationUsage) => {
      setActiveKey(null);
      // Let the dialog unmount before scrolling; keep the timer so we can clear
      // it if the provider unmounts first.
      if (navTimer.current) clearTimeout(navTimer.current);
      navTimer.current = setTimeout(() => {
        const found = scrollToUsage(key, usage);
        if (!found && usage.route && onNavigate) onNavigate(usage.route);
      }, 60);
    },
    [onNavigate],
  );

  const handleSaved = useCallback(
    (entry: EditableEntry) => {
      const value = entry.values[locale];
      if (typeof value === 'string') applyLocalUpdate(entry.key, value);
      onSaved?.(entry);
    },
    [locale, applyLocalUpdate, onSaved],
  );

  const value = useMemo<GlotContextValue>(
    () => ({
      locale,
      isAdmin,
      editMode,
      interactive,
      setEditMode,
      toggleEditMode,
      config,
      client,
      resolve,
      activeKey,
      openEditor,
      closeEditor,
      applyLocalUpdate,
      navigateToUsage,
    }),
    [
      locale,
      isAdmin,
      editMode,
      interactive,
      setEditMode,
      toggleEditMode,
      config,
      client,
      resolve,
      activeKey,
      openEditor,
      closeEditor,
      applyLocalUpdate,
      navigateToUsage,
    ],
  );

  return (
    <GlotContext.Provider value={value}>
      {children}
      {isAdmin && activeKey !== null ? (
        <Suspense fallback={<div className="glot-overlay" aria-hidden="true" />}>
          <EditorDialog activeKey={activeKey} onSaved={handleSaved} />
        </Suspense>
      ) : null}
    </GlotContext.Provider>
  );
}
