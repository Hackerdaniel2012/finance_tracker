# Repository Guidelines

## Scope and structure

- This is a local-first SvelteKit finance tracker using Cloudflare D1.
- `src/routes/` contains pages and same-origin `/api/*` endpoints.
- `src/lib/` contains shared typed modules, adapters, validation, and reporting.
- `migrations/` contains versioned D1 SQL; `tests/` and colocated `*.test.ts` contain tests; `e2e/` contains Playwright flows.

## Engineering rules

- Complete changes end to end: schema, types, APIs, UI, translations, tests, and docs must agree.
- Rename semantic concepts completely across code, keys, interfaces, tests, and documentation; never keep an obsolete alias.
- Put every visible UI string behind Paraglide in both `messages/en.json` and `messages/de.json`; do not hardcode labels.
- For translation-key renames, update both locale files and all `m.<key>()` calls, run `svelte-kit sync`, then search for the old key with `rg`.
- For new schema/enum values, update the type union, registry, validation, D1 constraints, migration, API, UI, and tests together.
- Never edit an applied migration; add a new versioned migration that preserves existing data and foreign-key behavior, with a migration test for old and new data.
- Search for existing components and patterns before adding UI; extract only genuinely repeated behavior or styling into shared components.
- Prefer small, strictly typed TypeScript modules, explicit adapter interfaces, and focused API handlers.
- Keep route directories lowercase kebab-case; use camelCase for values/functions and PascalCase for types/components.
- Never store raw bank CSVs or log raw transaction rows; keep secrets out of source control.

## Verification

- Use `rtk pnpm check` for SvelteKit and TypeScript checks.
- Use `rtk pnpm test` for Vitest and `rtk pnpm test:e2e` for Playwright smoke coverage.
- Test adapters with approved, anonymized fixtures, malformed rows, normalization, and deduplication; keep fixture policy consistent with `.gitignore`.
- Test migrations, import preview/confirm, categorization, reporting, recurring logic, and destructive flows.
- Run relevant tests and `git diff --check` before finishing; report unrelated pre-existing failures explicitly.
