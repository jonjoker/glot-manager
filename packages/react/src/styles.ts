/**
 * Self-contained styles, injected once into <head>. No external CSS file to
 * import and no styling-library dependency. Everything is namespaced under
 * `.glot-*` so it can't collide with the host app.
 */

const STYLE_ID = 'glot-styles';

const CSS = `
.glot-editable {
  cursor: pointer;
  border-radius: 3px;
  outline: 1px dashed rgba(217, 119, 6, 0.7);
  outline-offset: 1px;
  background-color: rgba(251, 191, 36, 0.18);
  transition: background-color 120ms ease, outline-color 120ms ease;
}
.glot-editable:hover,
.glot-editable:focus-visible {
  background-color: rgba(251, 191, 36, 0.38);
  outline-color: rgba(180, 83, 9, 0.9);
}
.glot-ring {
  animation: glot-ring-pulse 2.4s ease-out;
  border-radius: 4px;
}
@keyframes glot-ring-pulse {
  0%, 35% { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.75); }
  100% { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0); }
}

.glot-overlay {
  position: fixed; inset: 0; z-index: 2147483000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(15, 23, 42, 0.55); padding: 16px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.glot-dialog {
  background: #fff; color: #0f172a; width: min(900px, 100%);
  max-height: 88vh; overflow: auto; border-radius: 12px;
  box-shadow: 0 24px 60px rgba(2, 6, 23, 0.45);
  display: flex; flex-direction: column;
}
.glot-dialog * { box-sizing: border-box; }
.glot-dialog-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; padding: 18px 22px; border-bottom: 1px solid #e2e8f0;
}
.glot-dialog-title { font-size: 15px; font-weight: 600; margin: 0; }
.glot-key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #475569; word-break: break-all; }
.glot-badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: #4338ca; margin-top: 6px; }
.glot-body { display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; padding: 20px 22px; }
@media (max-width: 720px) { .glot-body { grid-template-columns: 1fr; } }
.glot-field { margin-bottom: 14px; }
.glot-label { display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 5px; }
.glot-textarea, .glot-select {
  width: 100%; font: inherit; font-size: 13px; color: #0f172a;
  border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; background: #fff;
}
.glot-textarea { min-height: 64px; resize: vertical; }
.glot-textarea:focus, .glot-select:focus { outline: 2px solid #6366f1; outline-offset: 0; border-color: #6366f1; }
.glot-textarea.glot-source { border-color: #f59e0b; background: #fffbeb; }
.glot-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
.glot-panel h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
.glot-usage { display: block; width: 100%; text-align: left; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; font: inherit; font-size: 13px; }
.glot-usage:hover { border-color: #94a3b8; }
.glot-usage small { color: #64748b; }
.glot-issue { font-size: 12px; color: #b45309; margin-top: 6px; }
.glot-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 16px 22px; border-top: 1px solid #e2e8f0; }
.glot-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; }
.glot-btn:disabled { opacity: 0.55; cursor: progress; }
.glot-btn-secondary { background: #fff; border-color: #cbd5e1; color: #334155; }
.glot-btn-secondary:hover:not(:disabled) { background: #f1f5f9; }
.glot-btn-primary { background: #4f46e5; color: #fff; }
.glot-btn-primary:hover:not(:disabled) { background: #4338ca; }
.glot-btn-translate { background: #0f766e; color: #fff; width: 100%; }
.glot-btn-translate:hover:not(:disabled) { background: #115e59; }
.glot-skeleton { height: 12px; border-radius: 6px; background: linear-gradient(90deg,#eef2f7,#e2e8f0,#eef2f7); background-size: 200% 100%; animation: glot-shimmer 1.2s infinite; margin: 8px 0; }
@keyframes glot-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.glot-toggle { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 13px; cursor: pointer; user-select: none; background: none; border: none; color: inherit; padding: 0; }
.glot-toggle-track { width: 34px; height: 20px; border-radius: 999px; background: #cbd5e1; position: relative; transition: background 120ms ease; flex: none; }
.glot-toggle-track[data-on="true"] { background: #4f46e5; }
.glot-toggle-thumb { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 120ms ease; box-shadow: 0 1px 2px rgba(0,0,0,0.3); }
.glot-toggle-track[data-on="true"] .glot-toggle-thumb { transform: translateX(14px); }
`;

/** Inject the Glot Manager stylesheet once. Safe to call repeatedly and during SSR. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
