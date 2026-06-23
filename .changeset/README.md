# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

When you make a user-facing change, run:

```bash
npm run changeset
```

and follow the prompts. Commit the generated markdown file alongside your code.
Releases are cut by running `npm run version-packages` followed by
`npm run release`. All `@glot/*` packages are versioned together (`fixed`).
