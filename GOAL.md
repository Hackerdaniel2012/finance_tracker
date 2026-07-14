You are Codex working in an existing repository. Implement Finance Tracker Cloudflare/SvelteKit V1 incrementally, with small, reviewable steps and separate clean commits for each completed change.

Primary goal

Build a local-first, single-user, serverless finance tracker using:

- SvelteKit
- TypeScript
- pnpm
- Tailwind CSS + Tailwind Forms
- Paraglide i18n with English and German
- LayerChart
- Vitest
- Playwright
- ESLint
- Prettier
- Cloudflare Pages with @sveltejs/adapter-cloudflare
- Cloudflare D1 through a binding named DB

Use SvelteKit /api/* endpoints for backend logic. Do not create a root /functions directory. Server endpoints must access D1 through the Cloudflare binding.

Privacy defaults:

- No authentication in v1.
- No multi-user model.
- No raw CSV storage.
- No raw CSV row logging.
- No external AI calls.
- Store only import metadata such as hash, counts, adapter/profile, and timing.

Working rules

Work in strict incremental phases.

For every phase:

1. Inspect the existing repository first.
2. Make the smallest coherent change.
3. Add or update tests for that change.
4. Run the relevant checks/tests.
5. Review your own diff.
6. Refactor for clarity, duplication, naming, and type safety.
7. Re-run tests after refactoring.
8. Create one clean commit with a clear message.
9. Do not mix unrelated changes in one commit.

Use conventional commit style where practical, for example:

- chore: scaffold cloudflare sveltekit app
- feat(import): add dkb csv adapter
- test(import): cover malformed csv rows
- refactor(transactions): deduplicate filter mapping

Do not mark v1 complete until all required checks pass:

pnpm check
pnpm test
pnpm test:e2e
pnpm build

Important implementation constraints

Use wrangler.jsonc with:

- compatibility_date: "2026-07-08"
- Cloudflare Pages/SvelteKit adapter configuration
- D1 binding named DB
- tracked SQL migrations

Use D1 migrations for all schema changes. Do not hand-maintain production schema outside migrations.

Use same-origin /api/* calls from the client.

Keep domain logic testable outside SvelteKit handlers where possible. API handlers should validate inputs, call service/repository functions, and return typed JSON responses.

Use TypeScript strictly. Avoid any unless there is a short comment explaining why it is unavoidable.

Required product scope

Implement:

- Account/profile management
- Bank CSV adapters for N26, Trade Republic, and DKB
- CSV preview/confirm import flow
- Dedupe by (profile_id, dedupe_key)
- Categorization rules and manual overrides
- Unknown transaction review queue
- Account transaction search/filter/sort/pagination
- Summary dashboard
- Net worth chart
- Unified one-off and recurring expense/income plans
- Recurring suggestions with confirmation and supporting evidence
- Current-month expense and income outlooks
- Balance-before-next-income projection
- Liabilities with interest and linked installment plans
- Basic bilingual UI labels through i18n

Data model

Create D1 migrations for at least:

- accounts
- import_profiles
- import_batches
- transactions
- categories
- category_rules
- tags
- transaction_tags
- recurring_groups
- recurring_group_transactions
- plans
- plan_transactions
- liabilities
- account_balance_snapshots
- marked_liabilities
- transaction_review_flags
- import_row_errors

In v1, each account maps one-to-one to exactly one import profile.

Normalize transactions to:

- signed EUR cents
- booking date as canonical reporting date
- optional value date
- optional original amount
- optional original currency
- optional exchange rate
- optional balance after transaction
- one primary category
- many tags
- note/search text
- classification/review status
- stable dedupe key

Bank adapter interface

Implement bank adapters behind a shared interface:

export type BankId = 'n26' | 'trade_republic' | 'dkb';
export interface BankAdapter {
id: BankId;
label: string;
status: 'enabled' | 'disabled';
requiredColumns: string[];
parse(csv: string): ParseResult;
}

Enable:

- N26
- Trade Republic
- DKB

Use only synthetic, repository-safe fixtures from `tests/fixtures/`.

The DKB adapter must handle:

- Girokonto metadata preamble
- semicolon-delimited quoted columns
- German dd.mm.yy dates
- comma decimals
- Ausgang / Eingang direction values
- payment/reference fields from the synthetic DKB giro fixture

Dedupe rules:

- Trade Republic: use transaction_id when available.
- DKB: use Kundenreferenz when available.
- N26/DKB fallback: use a stable normalized fingerprint.

API surface

Implement the following endpoints:

GET /api/banks
GET /api/accounts
POST /api/accounts
PATCH /api/accounts
GET /api/profiles
POST /api/profiles
POST /api/imports/preview
POST /api/imports/confirm
GET /api/imports
DELETE /api/imports/:id
GET /api/transactions
PATCH /api/transactions/:id
GET /api/transactions/unknown
GET /api/categories
POST /api/categories
PATCH /api/categories
GET /api/category-rules
POST /api/category-rules
PATCH /api/category-rules
GET /api/summary
GET /api/net-worth
GET /api/recurring
PATCH /api/recurring/:id
POST /api/recurring/:id/confirm
GET /api/plans
POST /api/plans
PATCH /api/plans
DELETE /api/plans
GET /api/liabilities
POST /api/liabilities
PATCH /api/liabilities
DELETE /api/liabilities
GET /api/balance-before-income

Import flow

Implement preview/confirm as a two-step flow.

Preview:

- Accept multipart CSV upload.
- Parse file.
- Return summary, file hash, date range, duplicate estimate, sample normalized rows, and parse errors.
- Must not write to D1.

Confirm:

- Accept multipart CSV upload plus expectedHash.
- Recompute hash and reject mismatch.
- Reparse file.
- Categorize rows.
- Dedupe rows.
- Insert valid non-duplicate rows.
- Create an import batch.
- Store import row errors for invalid rows.
- Return an import report.
- Discard raw CSV content after request.

Categorization and review

Seed editable categories.

Rules are global by default.

Support:

- automatic category assignment from rules
- manual transaction category override
- manual tag editing
- notes
- explicit “create rule from this edit”
- review flag for unknown transactions

Imported transactions without a category/rule match must be flagged for review.

The unknown queue must support:

- list flagged transactions
- manual classification
- optional rule creation
- clearing the review flag once handled

Recurring suggestions and plans

Recurring detection must be conservative:

- only suggest recurring groups after at least three similar transactions
- require stable cadence
- suggestions must be confirmable or ignorable later

Plans must support:

- expense and income directions
- once, daily, weekly, biweekly, monthly, quarterly, and yearly cadence
- expected amount, next date, and optional end date
- linked account, category, payee, status, source, and notes
- automatic transaction matching with an auditable, reversible match ledger
- deterministic calendar anchoring for month-end and leap-year schedules

Current-month outlooks use active plans only and exclude unconfirmed recurring suggestions. Balance-before-next-income uses the next active income plan regardless of category or cadence, or an explicit manual projection date.

Reports and charts

Reports default to the last 12 months.

Support:

- per-account view
- combined view
- cashflow
- category trends
- balances
- chart-ready series

Trade Republic buys/sells count in main cashflow.

Do not special-case internal transfers in v1.

Net worth chart:

- stock-like time-series behavior
- combined and per-account views
- use imported balance-after-transaction values where available
- otherwise fall back to configured starting/current balances plus transaction deltas
- exclude manually tracked assets in v1
- include manually marked liabilities

UI requirements

Build a practical UI for:

- account/profile setup
- CSV preview/confirm import
- dashboard
- account transaction table
- transaction search/filter/sort/pagination
- unknown transaction review
- category editing
- expense and income plans
- recurring suggestions
- current-month plan outlooks
- balance-before-next-income
- liabilities
- net worth chart

Use Paraglide/i18n for default English and German labels. Browser language should choose German or English, with English fallback.

Use LayerChart for dashboard/net worth visualizations.

Testing requirements

Follow best practices for logic, API, and UI tests.

Unit tests

Add Vitest tests for all bank adapters using existing fixtures.

Cover:

- headers
- metadata preambles
- DKB semicolon quoted fields
- date parsing
- amount signs
- currency fields
- direction handling
- dedupe keys
- malformed rows
- skipped rows
- parse errors

Include bad examples that assert failure behavior, for example:

- malformed date is rejected or reported
- missing required column fails validation
- invalid amount is skipped or reported
- wrong expected hash is rejected
- duplicate import does not insert duplicate rows

Do not write tests that intentionally fail the test suite. “Bad examples” means negative-path inputs with passing assertions that verify correct failure handling.

D1 integration tests

Add integration tests for:

- migrations
- account/profile one-to-one linkage
- import preview
- import confirm
- dedupe
- import batch deletion with transactions
- categorization rules
- transaction edits
- transaction search/filtering
- summary reports
- net worth series with marked liabilities
- plan CRUD, matching, rollback, status, and end dates
- recurring confirmation and evidence preservation
- current-month plan outlooks
- balance-before-next-income estimates
- liability-plan invariants and interest projections
- review-flagged unknown transaction queues
- recurring suggestions

Use isolated test database setup. Tests must be deterministic and safe to run repeatedly.

API tests

Test success and failure paths.

Cover:

- validation errors
- missing fields
- invalid IDs
- hash mismatch
- duplicate imports
- malformed multipart input
- invalid date ranges
- unknown adapter/profile/account
- empty result sets

UI / Playwright tests

Add one Playwright smoke flow using the in-app browser:

1. Create profile/account.
2. Preview fixture CSV.
3. Confirm import.
4. View dashboard.
5. Search account transactions.
6. Open unknown transaction review queue.
7. Change one category.
8. Optionally create a category rule from the edit.
9. Verify review flag clears.
10. Verify chart/table updates.

Use resilient Playwright locators and web-first assertions. Avoid brittle sleeps.

Suggested implementation phases

Phase 1 — Scaffold and tooling

Set up SvelteKit, Cloudflare adapter, TypeScript, pnpm scripts, ESLint, Prettier, Tailwind, Tailwind Forms, Vitest, Playwright, Paraglide, and LayerChart.

Add basic routes and health-style checks.

Run:

pnpm check
pnpm test
pnpm build

Commit only scaffold/tooling changes.

Phase 2 — Cloudflare/D1 foundation

Add wrangler.jsonc, D1 binding config, migrations folder, database helpers, and test DB utilities.

Create initial schema migrations.

Add migration/integration tests.

Run relevant checks.

Commit schema and D1 foundation separately.

Phase 3 — Bank adapter core

Add shared bank adapter types, parse result types, normalization helpers, hash/fingerprint helpers, date/amount parsing helpers, and tests.

Implement N26, Trade Republic, and DKB adapters.

Add fixture-based unit tests and negative-path tests.

Run tests.

Refactor adapter duplication.

Commit adapter implementation.

Phase 4 — Import profiles/accounts

Implement account/profile APIs and one-to-one linkage.

Add service/repository layer.

Add API/integration tests.

Add minimal UI for creating account/profile.

Run checks/tests.

Commit account/profile feature.

Phase 5 — Import preview/confirm

Implement multipart preview/confirm.

Add dedupe, import batches, import row errors, hash validation, and no-raw-CSV persistence.

Add API/integration tests with good and bad examples.

Run checks/tests.

Refactor duplicate parse/validation logic.

Commit import flow.

Phase 6 — Categories and review queue

Implement seeded categories, category rules, categorization during import, manual edits, unknown review flags, and rule creation from edits.

Add API, UI, and integration tests.

Run checks/tests.

Commit categorization/review feature.

Phase 7 — Transactions UI and search

Implement account transaction table with filtering, search, sorting, pagination, category/tag/note editing, and classification status filters.

Add API and UI tests.

Run checks/tests.

Commit transaction search feature.

Phase 8 — Summary and net worth

Implement summary endpoint, dashboard cards, cashflow/category trends, balances, and net worth time series.

Add liabilities support.

Add tests for combined/per-account views and liabilities.

Run checks/tests.

Commit reporting feature.

Phase 9 — Plans, recurring suggestions, and liabilities

Implement unified expense/income plans, recurring suggestions, confirmation/ignore flow, current-month outlooks, balance-before-next-income, and linked liabilities.

Add API/integration tests.

Run checks/tests.

Commit plans/recurring/liabilities feature.

Phase 10 — Full Playwright smoke test and polish

Add full Playwright smoke test using the app.

Run:

pnpm check
pnpm test
pnpm test:e2e
pnpm build

Review all diffs.

Refactor and deduplicate.

Ensure privacy constraints are satisfied.

Commit final v1 polish.

Code review checklist before every commit

Before committing, inspect the diff and confirm:

- The change is scoped to one phase or feature.
- Tests cover success and failure paths.
- No raw CSV content is stored or logged.
- No external AI/network calls are added.
- D1 access is isolated behind clear helpers/repositories.
- API handlers are thin and typed.
- Validation errors are clear and consistent.
- No obvious duplicated parsing/query/filter logic remains.
- UI strings use i18n where user-facing.
- Tests are deterministic.
- pnpm check and relevant tests pass.

Final completion criteria

V1 is complete only when:

- All listed APIs exist.
- Core UI flows work.
- All adapters parse existing fixtures.
- D1 migrations apply cleanly.
- Import preview writes nothing.
- Import confirm dedupes and records import metadata.
- Unknown transactions are reviewable and clearable.
- Expense and income outlooks are separate and derive only from plans.
- Balance-before-next-income uses the next active income plan.
- Net worth includes marked liabilities and excludes manual assets.
- No raw CSV is persisted or logged.
- pnpm check passes.
- pnpm test passes.
- pnpm test:e2e passes.
- pnpm build passes.
- The repository history contains separate clean commits for each major step.
