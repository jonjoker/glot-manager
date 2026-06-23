# React client

`@glot/react` is the browser half: a provider, a component, a hook, and a toggle.
The in-context editor overlay is **code-split** and loads only for admins who
turn on edit mode.

## `<GlotProvider>`

Wrap your app once (it's a client component — mount it in a `'use client'`
boundary, e.g. a `providers.tsx`).

```tsx
<GlotProvider locale="en" messages={messages} isAdmin={isAdmin} onSaved={() => router.refresh()}>
  {children}
</GlotProvider>
```

| Prop              | Type                                               | Default          | Description                                                         |
| ----------------- | -------------------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| `locale`          | `string`                                           | —                | The current display locale.                                         |
| `messages`        | `Record<string, unknown>`                          | —                | Flat (`{"a.b": "…"}`) or nested messages for `locale`. Optional.    |
| `isAdmin`         | `boolean`                                          | `false`          | Whether edit mode is available. **UX only** — the server re-checks. |
| `endpoint`        | `string`                                           | `/api/glot`      | Where the server handler is mounted.                                |
| `defaultEditMode` | `boolean`                                          | `false`          | Initial toggle state (admins).                                      |
| `persist`         | `boolean`                                          | `true`           | Persist the toggle in `localStorage`.                               |
| `storageKey`      | `string`                                           | `glot:edit-mode` | localStorage key.                                                   |
| `revealKey`       | `'Alt' \| 'Control' \| 'Meta' \| 'Shift' \| false` | `'Alt'`          | Hold-to-reveal modifier.                                            |
| `fetcher`         | `typeof fetch`                                     | global `fetch`   | Custom fetch (auth headers, etc.).                                  |
| `onSaved`         | `(entry) => void`                                  | —                | After a save — e.g. `router.refresh()`.                             |
| `onNavigate`      | `(route) => void`                                  | —                | When a "Used in" target is on another page.                         |

## `<T>`

```tsx
<T id="app.hero.title">Welcome to Acme</T>
<T id="nav.pricing">{t('nav.pricing')}</T>
```

- Resolves text from `messages[id]`, falling back to `children`.
- Outside edit mode: renders the text with **no wrapper** (zero overhead).
- In edit mode (admin): renders a highlighted, click-to-edit `<span>`.
- Never shows a raw key — if nothing resolves, it shows your `children`.

Usage metadata for the "Used in" panel (all optional):
`usageId`, `usageLabel`, `usageRoute`, `usageSubItem`, `usageNotes`, plus
`className` and `title`.

## `useT()`

For places that need a **string**, not an element (e.g. `aria-label`,
`placeholder`, `title`). The result is not click-to-edit.

```tsx
const t = useT();
<input aria-label={t('search.label', 'Search')} />;
```

## `useGlot()`

Programmatic control:

```tsx
const { editMode, isAdmin, toggleEditMode, setEditMode, openEditor } = useGlot();
```

## `<EditModeToggle>`

A ready-made switch (renders nothing for non-admins). Or build your own with
`useGlot().toggleEditMode`.

```tsx
<EditModeToggle label="Translation edit mode" />
```

## Making text editable two ways

1. **Wrap JSX directly** with `<T id="…">…</T>`.
2. **Via component props** — pass keys down and wrap internally. Add the
   `data-glot-*` attributes (the editor reads them for live "Used in" detection)
   by rendering through `<T>` / `EditableText`.

## RSC / Next.js notes

Every module in `@glot/react` carries `"use client"`, so it's a client boundary.
You may render `<T>` / `<EditModeToggle>` inside Server Components (a server
component can render client components); just keep `<GlotProvider>` itself inside
a client module. The editor dialog is a separate chunk loaded on demand.

## Styling

Styles are injected once into `<head>`, namespaced under `.glot-*`. No CSS file
to import and no styling-library dependency. Override by targeting those classes,
or pass `className` to `<T>` / `<EditModeToggle>`.

## Limitations

- DOM-based "Used in" detection can't see text inside **Shadow DOM** or rendered
  to **canvas**. Those strings are still editable via the static usage registry.
