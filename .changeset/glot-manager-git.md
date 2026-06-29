---
'@glot-manager/git': minor
---

Add `@glot-manager/git`: git-backed import / edit / publish for Glot Manager.

Treat your website's repo of JSON language files as the source of truth — import
them into a `TranslationStore`, edit in context, then publish the changed keys
back as a commit or pull request. Ships a GitHub backend (Git-Data API over
`fetch`, opens PRs, edge-safe) and a system-`git` backend (`child_process`), with
a pluggable `GitBackend` port for bringing your own. Publishes are idempotent,
use a content-level targeted merge that preserves concurrent edits, retry on a
non-fast-forward, and never embed the auth token in a URL, argv, or on disk.
