import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  mergeUsages,
  type ConfigResponse,
  type EditableEntry,
  type Locale,
  type LocaleValues,
  type TranslationUsage,
  type ValidationIssue,
} from '@glot-manager/core';
import { useGlotContext } from '../context.tsx';
import { GlotApiError } from '../client.ts';
import { getMountedUsages } from '../dom-usage.ts';

interface EditorDialogProps {
  activeKey: string;
  onSaved: (entry: EditableEntry) => void;
}

type Status = 'loading' | 'ready' | 'error';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function EditorDialog({ activeKey, onSaved }: EditorDialogProps): ReactNode {
  const ctx = useGlotContext();
  const { client, config, closeEditor, navigateToUsage } = ctx;

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<EditableEntry | null>(null);
  const [draft, setDraft] = useState<LocaleValues>({});
  const [sourceLocale, setSourceLocale] = useState<Locale>('en');
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [domUsages, setDomUsages] = useState<TranslationUsage[]>([]);
  const [localConfig, setLocalConfig] = useState<ConfigResponse | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Track liveness + the current key so late network responses can't update an
  // unmounted dialog or merge a stale result into a different key's draft.
  const alive = useRef(true);
  const keyRef = useRef(activeKey);
  keyRef.current = activeKey;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const cfg = config ?? localConfig;

  // Self-heal config if the provider's fetch hasn't landed (or failed).
  useEffect(() => {
    if (config) return;
    let cancelled = false;
    client
      .getConfig()
      .then((c) => {
        if (!cancelled) setLocalConfig(c);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load editor configuration');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [config, client]);

  // Load the entry whenever the active key changes.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setIssues([]);
    setDomUsages(getMountedUsages(activeKey));
    client
      .getEntry(activeKey)
      .then((loaded) => {
        if (cancelled) return;
        setEntry(loaded);
        setDraft({ ...loaded.values });
        setSourceLocale(loaded.sourceLocale);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load translation');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [activeKey, client]);

  // Escape to close, focus trap (Tab/Shift+Tab wrap), and focus restore on close.
  useEffect(() => {
    const previouslyFocused = (
      typeof document !== 'undefined' ? document.activeElement : null
    ) as HTMLElement | null;
    const node = dialogRef.current;
    node?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeEditor();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [closeEditor]);

  const locales = cfg?.locales ?? [];
  const localeName = (locale: Locale): string => cfg?.localeNames?.[locale] ?? locale;
  const usages = useMemo(() => mergeUsages(entry?.usages, domUsages), [entry, domUsages]);
  const canAutoTranslate = Boolean(cfg?.autoTranslate);
  const hasSource = Boolean(draft[sourceLocale]?.trim());
  const ready = status === 'ready' && cfg !== null;

  async function handleAutoTranslate() {
    const requestedKey = activeKey;
    setTranslating(true);
    setError(null);
    try {
      const result = await client.autoTranslate(requestedKey, { sourceLocale, values: draft });
      if (!alive.current || keyRef.current !== requestedKey) return;
      setDraft((prev) => ({ ...prev, ...result.values }));
      setIssues(result.issues ?? []);
    } catch (err) {
      if (!alive.current || keyRef.current !== requestedKey) return;
      setError(err instanceof GlotApiError ? err.message : 'Auto-translate failed');
    } finally {
      if (alive.current && keyRef.current === requestedKey) setTranslating(false);
    }
  }

  async function handleSave() {
    const requestedKey = activeKey;
    setSaving(true);
    setError(null);
    try {
      const saved = await client.saveEntry(requestedKey, { sourceLocale, values: draft });
      onSaved(saved);
      closeEditor();
    } catch (err) {
      if (!alive.current || keyRef.current !== requestedKey) return;
      setError(err instanceof GlotApiError ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  const overlay = (
    <div
      className="glot-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeEditor();
      }}
    >
      <div
        className="glot-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit translation"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="glot-dialog-head">
          <div>
            <p className="glot-dialog-title">Edit translation</p>
            <div className="glot-key">{activeKey}</div>
            {entry?.namespace ? <span className="glot-badge">{entry.namespace}</span> : null}
          </div>
          <button
            type="button"
            className="glot-btn glot-btn-secondary"
            onClick={closeEditor}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {status === 'error' ? (
          <div className="glot-body">
            <p className="glot-issue">{error}</p>
          </div>
        ) : !ready ? (
          <div className="glot-body">
            <div>
              <div className="glot-skeleton" style={{ width: '40%' }} />
              <div className="glot-skeleton" style={{ height: 56 }} />
              <div className="glot-skeleton" style={{ height: 56 }} />
            </div>
            <div className="glot-skeleton" style={{ height: 120 }} />
          </div>
        ) : (
          <div className="glot-body">
            <div>
              <div className="glot-field">
                <label className="glot-label" htmlFor="glot-source-locale">
                  Source language
                </label>
                <select
                  id="glot-source-locale"
                  className="glot-select"
                  value={sourceLocale}
                  onChange={(e) => setSourceLocale(e.target.value)}
                >
                  {locales.map((locale) => (
                    <option key={locale} value={locale}>
                      {localeName(locale)} ({locale})
                    </option>
                  ))}
                </select>
              </div>

              {locales.map((locale) => (
                <div className="glot-field" key={locale}>
                  <label className="glot-label" htmlFor={`glot-ta-${locale}`}>
                    {localeName(locale)} ({locale}){locale === sourceLocale ? ' — source' : ''}
                  </label>
                  <textarea
                    id={`glot-ta-${locale}`}
                    className={`glot-textarea${locale === sourceLocale ? ' glot-source' : ''}`}
                    value={draft[locale] ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [locale]: e.target.value }))}
                  />
                </div>
              ))}
              {error ? <p className="glot-issue">{error}</p> : null}
            </div>

            <div>
              {canAutoTranslate ? (
                <div className="glot-panel" style={{ marginBottom: 14 }}>
                  <h3>Auto translate</h3>
                  <button
                    type="button"
                    className="glot-btn glot-btn-translate"
                    onClick={handleAutoTranslate}
                    disabled={translating || !hasSource}
                  >
                    {translating ? 'Translating…' : `Translate from ${localeName(sourceLocale)}`}
                  </button>
                  {!hasSource ? <p className="glot-issue">Enter source text first.</p> : null}
                  {issues.map((issue, i) => (
                    <p className="glot-issue" key={i}>
                      ⚠ {issue.message}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="glot-panel">
                <h3>Used in ({usages.length})</h3>
                {usages.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#64748b' }}>No known usages.</p>
                ) : (
                  usages.map((usage) => (
                    <button
                      type="button"
                      key={`${usage.id}:${usage.route ?? ''}:${usage.label}`}
                      className="glot-usage"
                      onClick={() => navigateToUsage(activeKey, usage)}
                    >
                      {usage.label}
                      {usage.route || usage.subItem ? (
                        <small>
                          {' — '}
                          {[usage.route, usage.subItem].filter(Boolean).join(' › ')}
                        </small>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="glot-foot">
          <button
            type="button"
            className="glot-btn glot-btn-secondary"
            onClick={closeEditor}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="glot-btn glot-btn-primary"
            onClick={handleSave}
            disabled={saving || !ready}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(overlay, document.body);
}
