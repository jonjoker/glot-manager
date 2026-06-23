# Security Policy

## Supported versions

Glot Manager is pre-1.0; security fixes land on the latest `0.x` release.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](https://github.com/jonjoker/glot-manager/security/advisories/new)
(Security → Report a vulnerability), or email the maintainers at
`security@glot.dev`.

Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal repro is ideal),
- affected package(s) and version(s).

We'll acknowledge within a few business days and keep you updated through to a
fix and coordinated disclosure.

## Scope highlights

Glot Manager edits live production copy, so we care especially about:

- authorization bypass (the `authorize` gate or the client/server trust boundary),
- CSRF on the mutating endpoints,
- the editable-key allowlist and prototype-pollution safety,
- SQL injection in storage adapters,
- leakage of the LLM API key or other secrets in responses/logs.

See [docs/security.md](./docs/security.md) for the threat model and built-in
defenses.
