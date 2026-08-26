# Finance Tracker

Local-first, single-user finance tracker for CSV imports, cashflow reporting, planning, and net worth history.

The dashboard includes selectable category cost projections. For each selected expense category,
the projected current-month cost is the higher of the previous three complete months' average and
the current month's actual spending plus remaining planned payments. The selection is stored only
in the local browser.

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
