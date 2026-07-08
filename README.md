# Finance Tracker

Local-first, single-user finance tracker for CSV imports, cashflow reporting, planning, and net worth history.

The project is built with SvelteKit, TypeScript, Tailwind CSS, Paraglide, LayerChart, Vitest, Playwright, and Cloudflare Pages. Backend functionality lives in SvelteKit `/api/*` endpoints and will use Cloudflare D1 through a `DB` binding.

## Development

```bash
pnpm install
pnpm dev
pnpm check
pnpm test
pnpm build
```

When running commands through Codex, prefix them with `rtk`.
