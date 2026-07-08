# Repository Guidelines

## Project Structure & Module Organization

This repository is currently a planning scaffold for a local-first finance tracker. Treat `PLAN.md` as the product and architecture source of truth until the SvelteKit project is generated. Existing CSV fixtures live in `example_data/` and should be used for adapter tests; do not commit raw user bank exports outside approved fixtures.

Expected implementation layout:

- `src/routes/`: SvelteKit pages and same-origin `/api/*` endpoints.
- `src/lib/`: shared TypeScript modules, bank adapters, validation, and reporting logic.
- `migrations/`: tracked Cloudflare D1 SQL migrations.
- `tests/` or colocated `*.test.ts`: unit and integration tests.
- `e2e/`: Playwright smoke tests.

## Build, Test, and Development Commands

Use `pnpm` after the app is scaffolded. When running commands through Codex, prefix shell commands with `rtk`.

- `rtk pnpm install`: install project dependencies.
- `rtk pnpm dev`: start the local SvelteKit development server.
- `rtk pnpm check`: run SvelteKit and TypeScript checks.
- `rtk pnpm test`: run Vitest unit/integration tests.
- `rtk pnpm test:e2e`: run Playwright browser tests.
- `rtk pnpm build`: create the Cloudflare Pages production build.

## Coding Style & Naming Conventions

Use TypeScript, SvelteKit, Tailwind CSS, ESLint, and Prettier as planned in `PLAN.md`. Prefer small, typed modules with explicit interfaces for bank adapters. Use `camelCase` for variables and functions, `PascalCase` for Svelte components and TypeScript types, and lowercase kebab-case for route directories. Keep API handlers focused on request parsing, D1 access, and response shaping.

## Testing Guidelines

Vitest should cover bank adapters, D1 migrations, import preview/confirm behavior, deduplication, categorization rules, summaries, and recurring detection. Name unit tests `*.test.ts`. Playwright should include at least one smoke flow covering profile creation, fixture import, dashboard viewing, category edit, and visible table/chart updates.

## Commit & Pull Request Guidelines

There is no established commit history yet. Use concise imperative commit messages, such as `Add N26 import adapter` or `Create D1 migration for transactions`. Pull requests should include a short summary, test commands run, linked issue if applicable, and screenshots for UI changes.

## Security & Configuration Tips

Keep v1 local-first and single-user as described in `PLAN.md`: no auth, no external AI, no raw CSV storage, and no raw row logging. Configure Cloudflare D1 through `wrangler.jsonc` with a `DB` binding, and keep secrets out of source control.
