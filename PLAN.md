# Finance Tracker Cloudflare/SvelteKit V1

  ## Summary

  - Build a local-first, single-user, fully serverless Cloudflare Pages project using SvelteKit, TypeScript, pnpm, Tailwind CSS, Paraglide i18n, LayerChart, Vitest, Playwright, ESLint, and Prettier.
  - Use a mostly static/client-driven UI that calls same-origin /api/* SvelteKit endpoints. The endpoints access D1 through the Cloudflare binding DB; do not use a root /functions directory because
    SvelteKit functions are implemented as endpoints in the compiled Cloudflare worker output.

  - Configure wrangler.jsonc with compatibility_date: "2026-07-08", @sveltejs/adapter-cloudflare, a D1 binding named DB, and tracked SQL migrations. D1 bindings and local D1 execution are supported through
    Wrangler.

  - Privacy defaults: no auth in v1, no raw CSV storage, no raw row logging, no external AI.
  - Core product scope: per-account transaction search, CSV import, categorization review, unified expense/income plans, recurring suggestions, balance-before-next-income projection, liabilities, and net worth history.

  ## Key Changes

  - Scaffold in the existing workspace with SvelteKit minimal TypeScript, Cloudflare adapter for Pages, Tailwind Forms, Paraglide for en/de, LayerChart for dashboard plots, and pnpm scripts for dev, build,
    check, test, and test:e2e.

  - Add D1 schema for accounts, import profiles, import batches, transactions, categories, category rules, tags, transaction tags, recurring groups, recurring group transactions, plans, plan transactions,
    account balance snapshots, liabilities, transaction review flags, and import row errors.
  - Implement bank adapters behind a shared interface:

    type BankId = 'n26' | 'trade_republic' | 'dkb';

    interface BankAdapter {
      id: BankId;
      label: string;
      status: 'enabled' | 'disabled';
      requiredColumns: string[];
      parse(csv: string): ParseResult;

  - Enable N26, Trade Republic, and DKB using synthetic fixtures in `tests/fixtures/`. The DKB adapter must handle the Girokonto metadata preamble, semicolon-delimited quoted columns, German dd.mm.yy
    dates, comma decimals, Ausgang/Eingang direction values, and synthetic payment/reference fields.
  - Normalize transactions to signed EUR cents, booking date as canonical reporting date, optional value date, optional original amount/currency/exchange rate, optional balance after transaction, one
    primary category, and many tags.
  - Model each imported bank CSV under an account/profile so every transaction can be queried by account, bank adapter, date range, direction, amount, merchant/payee, category, tag, note text, and
    classification status.

  - Deduplicate by (profile_id, dedupe_key), where Trade Republic uses transaction_id when available, DKB uses Kundenreferenz when available, and N26/DKB fallback to a stable normalized fingerprint.
  - Preview/confirm import flow parses twice: preview uploads and returns summary/hash without D1 writes; confirm resubmits the same file, reparses, categorizes, dedupes, inserts, and creates an import
    batch.

  - Categorization uses editable seeded categories, global-by-default rules, manual transaction overrides, and an explicit “create rule from this edit” path.
  - Recurring detection is conservative: suggest only after at least three similar transactions with stable cadence; suggestions can be confirmed/ignored later.
  - Add one plan workspace for one-off and recurring expenses and income. Store cadence, expected amount, next date, optional end date, linked account, category, payee, status, origin, and matched transactions.
  - Keep recurring suggestions separate until they are confirmed; confirmation atomically creates a plan and preserves its supporting transactions as evidence.
  - Add an unknown transactions review queue backed by an explicit review flag/status. Imported payments without a category or rule match are flagged for review; the queue supports manual
    classification, optional rule creation, and clearing the review flag once handled.
  - Reports default to the last 12 months, support per-account and combined views, count Trade Republic buys/sells in main cashflow, and do not special-case internal transfers.
  - Add an all-transactions view for each account with a searchable, sortable, paginated table of incoming and outgoing payments.
  - Add a net worth chart with stock-like time-series behavior. It supports combined and per-account views, uses imported balance-after-transaction values where available, falls back to configured
    starting/current balances plus transaction deltas, excludes manually tracked assets in v1, and includes manually marked liabilities.
  - Derive current-month expense and income outlooks exclusively from active plans, respecting cadence, status, end date, and matched transactions.
  - Add a balance-before-next-income estimate using the next active income plan regardless of category or cadence.
  - Match imported transactions conservatively to plan occurrences; unique matches advance recurring plans, complete one-off plans, and can be reversed when an import is deleted.

  ## API Surface

  - GET /api/banks: enabled/disabled bank adapter metadata.
  - GET/POST/PATCH /api/accounts: account metadata, opening balance, display settings, and account/profile linkage.
  - GET /api/profiles, POST /api/profiles: import profile management.
  - POST /api/imports/preview: multipart CSV preview with counts, date range, duplicate estimate, sample normalized rows, and parse errors.
  - POST /api/imports/confirm: multipart CSV confirmation with expectedHash; inserts valid rows, skips duplicates/invalid rows, returns import report.
  - GET /api/imports, DELETE /api/imports/:id: list imports and delete an import batch with its transactions.
  - GET /api/transactions, PATCH /api/transactions/:id: filter/search transactions by account, date, direction, amount, text, category, tag, and classification/review status; edit category/tags/notes and
    clear review flags.
  - GET /api/transactions/unknown: list review-flagged transactions that need manual classification.
  - GET/POST/PATCH /api/categories, GET/POST/PATCH /api/category-rules: maintain category taxonomy and matching rules.
  - GET /api/summary: account/combined cashflow, category trends, balances, and chart-ready series.
  - GET /api/net-worth: account/combined net worth time series for charting.
  - GET /api/recurring, PATCH /api/recurring/:id, POST /api/recurring/:id/confirm: review, ignore, or confirm recurring suggestions.
  - GET/POST/PATCH/DELETE /api/plans: maintain one-off and recurring expense/income plans.
  - GET/POST/PATCH/DELETE /api/liabilities: maintain manually marked liabilities included in net worth.
  - GET /api/balance-before-income: projected balance before the next active income-plan occurrence.

  ## Test Plan

  - Unit-test N26, Trade Republic, and DKB adapters against existing fixtures, including headers/preambles, date parsing, amount signs, currency fields, direction handling, dedupe keys, and skipped malformed
    rows.
  - Add D1 integration tests for migrations, one-to-one account/profile linkage, import preview/confirm, dedupe, batch deletion, categorization rules, transaction edits, transaction search/filtering,
    summaries, net worth series with liabilities, plan CRUD/matching/rollback, recurring confirmation, balance-before-next-income estimates, review-flagged unknown transaction
    queues, and recurring suggestions.
  - Add one Playwright smoke test: create profile/account, preview fixture CSV, confirm import, view dashboard, search account transactions, review an unknown transaction, change one category, and verify
    chart/table updates.
  - Run pnpm check, pnpm test, pnpm test:e2e, and a production build before considering v1 complete.

  ## Assumptions

  - Local-only v1 has no login, no multi-user tables, no budgets, no projections, and no split-amount transactions.
  - UI and default labels are bilingual through i18n; browser language chooses de or en, with English fallback.
  - Raw CSV contents are discarded after each request; import metadata stores only file hash, counts, adapter/profile, and timing.
  - An account is the product-facing container for transactions and balances; in v1, each account maps one-to-one to exactly one import profile.
  - Balance-before-next-income uses the next active income plan; an optional manual projection date may override it.
  - Expense and income outlooks use active plans only; unconfirmed recurring suggestions are never counted.
  - Net worth excludes manually tracked assets in v1 and includes manually marked liabilities.
  - Unknown transactions are transactions explicitly flagged for review, including imported rows without a category or rule match.
