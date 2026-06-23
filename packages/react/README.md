# @glot/react

The React client for [Glot Manager](https://github.com/jonjoker/glot-manager) — one provider, one
component, one hook, and an admin-only in-context translation editor that is
**code-split** (loads only when an admin turns on edit mode) and ships **no
invisible markers** to production.

```bash
npm install @glot/react
```

```tsx
'use client';
import { GlotProvider, T, EditModeToggle } from '@glot/react';

<GlotProvider locale="en" messages={messages} isAdmin={isAdmin}>
  <EditModeToggle />
  <h1>
    <T id="app.hero.title">Welcome to Acme</T>
  </h1>
</GlotProvider>;
```

- `<T id>` — renders the resolved message (or `children` as fallback); becomes a
  click-to-edit label in edit mode, zero overhead otherwise.
- `useT()` — resolve keys to plain strings (for `aria-label`, `placeholder`, …).
- `useGlot()` — programmatic control (`toggleEditMode`, `openEditor`, …).
- `<EditModeToggle>` — a ready-made switch (renders nothing for non-admins).

Requires a running [`@glot/server`](https://www.npmjs.com/package/@glot/server)
endpoint (default `/api/glot`). React 18 or 19 (peer dependency). RSC-ready
(`"use client"`).

📖 Full docs: [React client guide](https://github.com/jonjoker/glot-manager/blob/main/docs/react.md) ·
License: MIT
