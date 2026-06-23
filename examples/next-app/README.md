# Glot Manager · Next.js example

A minimal Next.js App Router app showing the full Glot Manager integration:

- **Server** — one route handler at [`app/api/glot/[...path]/route.ts`](app/api/glot/%5B...path%5D/route.ts)
  wires a store, a translator, and an authorizer.
- **Client** — one `<GlotProvider>` in [`app/providers.tsx`](app/providers.tsx),
  then `<T>` and `<EditModeToggle>` on the [page](app/page.tsx).
- **Storage** — an in-memory store ([`lib/glot.ts`](lib/glot.ts)) cached on
  `globalThis`, so edits persist across reloads for the life of the dev server.

## Run it

From the repository root:

```bash
npm install
npm run build           # build the @glot/* packages
npm run dev -w @glot/example-next
```

Open <http://localhost:3000>, toggle **Translation edit mode** (top right), and
click any highlighted label to edit it. Hold **Alt** to peek at editable labels
without flipping the toggle.

### Optional: real AI translations

By default the demo uses an offline echo translator (no API calls). To use
Claude, set a key before `npm run dev`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

The **Auto translate** button will then fill the other languages using
`claude-sonnet-4-6`, honoring the domain, style guide, and glossary defined in
`lib/glot.ts`.

> **Note:** This demo treats every visitor as an admin so you can try edit mode.
> A real app must check the user's session/role in the handler's `authorize`
> function (see the comment in the route file).
