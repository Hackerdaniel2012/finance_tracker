<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { MonthCashflowReport, UpcomingIncome } from '$lib/cashflow';
	import { buildAccountScopeOptions, buildAccountScopeQuery } from '$lib/account-scope';
	import { BarChart, LineChart } from 'layerchart/svg';
	import { onMount } from 'svelte';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import Picker from '$lib/components/Picker.svelte';

	interface AccountWithBalance {
		id: string;
		name: string;
		institution: string | null;
		openingBalanceCents: number;
		currentBalanceCents: number | null;
		balanceCents: number;
		subaccounts: string[];
	}

	interface SummaryReport {
		range: { from: string; to: string };
		totals: {
			incomeCents: number;
			expenseCents: number;
			netCents: number;
			transactionCount: number;
			unknownCount: number;
		};
		byAccount: Array<{ accountId: string; accountName: string; balanceCents: number }>;
		byCategory: Array<{
			categoryId: string | null;
			categoryName: string;
			type: string;
			expenseCents: number;
			incomeCents: number;
			netCents: number;
			transactionCount: number;
		}>;
		byMonthCategory: Array<{
			month: string;
			categoryId: string | null;
			categoryName: string;
			expenseCents: number;
		}>;
		recentTransactions: Array<{
			id: string;
			accountName: string;
			categoryName: string | null;
			bookingDate: string;
			amountCents: number;
			payee: string | null;
			classificationStatus: string;
		}>;
	}

	interface NetWorthReport {
		points: Array<{
			date: string;
			assetsCents: number;
			liabilitiesCents: number;
			netWorthCents: number;
		}>;
		accounts: Array<{ accountId: string; accountName: string; balanceCents: number }>;
		liabilities: Array<{ id: string; name: string; amountCents: number; asOfDate: string }>;
	}

	interface BalanceProjection {
		asOf: string;
		projectionDate: string;
		currentBalanceCents: number;
		upcomingPaymentCents: number;
		projectedBalanceCents: number;
		nextIncome: UpcomingIncome | null;
	}

	let accounts = $state<AccountWithBalance[]>([]);
	let summary = $state<SummaryReport | null>(null);
	let netWorth = $state<NetWorthReport | null>(null);
	let monthCashflow = $state<MonthCashflowReport | null>(null);
	let projection = $state<BalanceProjection | null>(null);
	let dashboardStatus = $state(m.dashboard_status_loading());
	let dashboardStatusTone = $state<'loading' | 'ready' | 'error'>('loading');
	let dashboardError = $state<string | null>(null);
	let dashboardAccountScope = $state('');

	const netWorthPoints = $derived(
		netWorth?.points.map((point) => ({
			date: new Date(`${point.date}T00:00:00.000Z`),
			netWorthCents: point.netWorthCents / 100
		})) ?? []
	);
	const totalAccountBalanceCents = $derived(
		netWorth?.accounts.reduce((sum, account) => sum + account.balanceCents, 0) ??
			accounts.reduce((sum, account) => sum + account.balanceCents, 0)
	);
	const expenseMonths = $derived.by(() => {
		const end = summary?.range.to ? new Date(`${summary.range.to}T00:00:00Z`) : new Date();
		return Array.from({ length: 3 }, (_, index) => {
			const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (2 - index), 1));
			return {
				month: date.toISOString().slice(0, 7),
				label: date.toLocaleDateString(undefined, {
					month: 'short',
					year: 'numeric',
					timeZone: 'UTC'
				})
			};
		});
	});
	const expenseCategoryPoints = $derived.by(() => {
		const rows = summary?.byMonthCategory ?? [];
		const categories = [...new Set(rows.map((row) => row.categoryName))];
		return expenseMonths.map((month) => ({
			...month,
			categories: categories.map((category) => ({
				category,
				expense:
					(rows.find((row) => row.month === month.month && row.categoryName === category)
						?.expenseCents ?? 0) / 100
			}))
		}));
	});
	const expenseYAxisMax = $derived(
		Math.max(
			1,
			...expenseCategoryPoints.flatMap((month) =>
				month.categories.map((category) => category.expense)
			)
		)
	);

	onMount(() => {
		void loadHomeState();
	});

	async function loadHomeState() {
		await loadAccounts();
		await loadDashboard();
	}

	async function loadAccounts() {
		try {
			const payload = await fetchJson<{ accounts: AccountWithBalance[] }>('/api/accounts');
			accounts = payload.accounts;
		} catch {
			accounts = [];
		}
	}

	async function loadDashboard() {
		dashboardStatus = m.dashboard_status_loading();
		dashboardStatusTone = 'loading';
		dashboardError = null;

		try {
			const reportQuery = buildDashboardReportQuery();
			const results = await Promise.allSettled([
				fetchJson<{ summary: SummaryReport }>(`/api/summary${reportQuery}`),
				fetchJson<{ netWorth: NetWorthReport }>(`/api/net-worth${reportQuery}`),
				fetchJson<{ monthCashflow: MonthCashflowReport }>(`/api/month-cashflow${reportQuery}`),
				fetchJson<{ projection: BalanceProjection }>(`/api/balance-before-income${reportQuery}`)
			]);
			if (results[0].status === 'fulfilled') summary = results[0].value.summary;
			if (results[1].status === 'fulfilled') netWorth = results[1].value.netWorth;
			if (results[2].status === 'fulfilled') monthCashflow = results[2].value.monthCashflow;
			if (results[3].status === 'fulfilled') projection = results[3].value.projection;
			if (results.some((result) => result.status === 'rejected')) {
				dashboardStatus = m.dashboard_status_error();
				dashboardStatusTone = 'error';
				dashboardError = m.dashboard_status_error();
			} else {
				dashboardStatus = m.dashboard_status_ready();
				dashboardStatusTone = 'ready';
			}
		} catch {
			dashboardStatus = m.dashboard_status_error();
			dashboardStatusTone = 'error';
			dashboardError = m.dashboard_status_error();
		}
	}

	async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
		return fetchJsonWithRetry<T>(url, init);
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
	}

	function buildDashboardReportQuery(): string {
		return dashboardAccountScope ? buildAccountScopeQuery(dashboardAccountScope) : '';
	}

	function formatDate(value: string | null): string {
		if (!value) return m.not_available();
		return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>{m.app_title()}</title>
	<meta name="description" content={m.app_subtitle()} />
</svelte:head>

<main class="mx-auto max-w-7xl px-4 py-6 lg:py-8">
	<section class="space-y-5">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<h1 class="text-3xl font-semibold tracking-normal text-zinc-950">{m.nav_dashboard()}</h1>
			<p
				class={`inline-flex items-center gap-1.5 text-sm font-medium ${
					dashboardStatusTone === 'error'
						? 'text-red-600'
						: dashboardStatusTone === 'ready'
							? 'text-emerald-600'
							: 'text-amber-600'
				}`}
				aria-live="polite"
			>
				{#if dashboardStatusTone === 'ready'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-4"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" />
					</svg>
				{:else if dashboardStatusTone === 'error'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-4"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" />
					</svg>
				{:else}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-4 animate-spin"
						aria-hidden="true"
					>
						<path d="M12 3a9 9 0 1 0 9 9" />
					</svg>
				{/if}
				{dashboardStatus}
			</p>
		</div>

		{#if dashboardError}
			<p class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
				{dashboardError}
				<button class="ml-3 underline" type="button" onclick={loadDashboard}>{m.retry()}</button>
			</p>
		{/if}
	</section>

	<section class="mt-4 grid gap-6">
		<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			<article class="rounded-ui border border-zinc-200 bg-white p-4 shadow-sm">
				<div class="grid gap-2">
					<span class="text-sm font-medium text-zinc-500">{m.dashboard_account_scope()}</span>
					<Picker
						ariaLabel={m.dashboard_account_scope()}
						placeholder={m.all_accounts()}
						options={[
							{ value: '', label: m.all_accounts() },
							...buildAccountScopeOptions(accounts)
						]}
						bind:value={dashboardAccountScope}
						onchange={() => loadDashboard()}
					/>
				</div>
			</article>
			<article class="rounded-ui border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-sm font-medium text-zinc-500">{m.total_balance()}</p>
				<p class="mt-2 text-2xl font-semibold text-zinc-950">
					{netWorth || accounts.length > 0 ? centsToEuros(totalAccountBalanceCents) : '—'}
				</p>
			</article>
			<article class="rounded-ui border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-sm font-medium text-zinc-500">{m.month_net()}</p>
				<p class="mt-2 text-2xl font-semibold text-zinc-950">
					{monthCashflow ? centsToEuros(monthCashflow.actual.netCents) : '—'}
				</p>
			</article>
			<article class="rounded-ui border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-sm font-medium text-zinc-500">{m.balance_before_next_income()}</p>
				<p class="mt-2 text-2xl font-semibold text-zinc-950">
					{projection ? centsToEuros(projection.projectedBalanceCents) : '—'}
				</p>
				<p class="mt-1 text-xs text-zinc-500">
					{m.projection_date()}: {formatDate(projection?.projectionDate ?? null)}
				</p>
			</article>
		</div>

		<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
			<div>
				<h2 class="text-lg font-semibold text-zinc-950">{m.net_worth()}</h2>
				<p class="mt-1 text-sm text-zinc-500">
					{summary?.range.from ?? ''} - {summary?.range.to ?? ''}
				</p>
			</div>
			<div class="mt-5 h-72 p-4">
				{#if netWorthPoints.length > 0}
					<LineChart
						data={netWorthPoints}
						x="date"
						y="netWorthCents"
						height={240}
						axis
						grid
						props={{ xAxis: { tickSpacing: 110 } }}
						class="h-full w-full text-emerald-700"
					/>
				{:else}
					<div
						class="flex h-full items-center justify-center rounded-ui border border-dashed border-zinc-300"
					>
						<p class="text-sm text-zinc-500">{m.no_chart_data()}</p>
					</div>
				{/if}
			</div>
		</section>

		<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
			<div>
				<h2 class="text-lg font-semibold text-zinc-950">{m.expenses_by_category()}</h2>
				<p class="mt-1 text-sm text-zinc-500">
					{expenseMonths[0]?.label} – {expenseMonths[2]?.label}
				</p>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-3">
				{#each expenseCategoryPoints as month, monthIndex (month.month)}
					<article class="min-w-0 rounded-ui bg-zinc-50 p-3">
						<h3 class="font-medium text-zinc-950">{month.label}</h3>
						<div class="mt-3 h-72 p-4">
							{#if month.categories.some((category) => category.expense > 0)}
								<BarChart
									data={month.categories}
									x="category"
									y="expense"
									yDomain={[0, expenseYAxisMax]}
									axis={monthIndex === 0 ? true : 'x'}
									grid
									series={[{ key: 'expense', value: 'expense', color: '#047857' }]}
									class="h-full w-full"
								/>
							{:else}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-zinc-500">{m.no_chart_data()}</p>
								</div>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		</section>

		<section class="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
			<article class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
				<h2 class="text-lg font-semibold text-zinc-950">{m.recent_transactions()}</h2>
				<div class="mt-4 divide-y divide-zinc-200">
					{#if (summary?.recentTransactions.length ?? 0) === 0}
						<p class="py-4 text-sm text-zinc-500">{m.no_recent_transactions()}</p>
					{:else}
						{#each summary?.recentTransactions ?? [] as transaction (transaction.id)}
							<div class="grid grid-cols-[1fr_auto] gap-3 py-3">
								<div>
									<p class="font-medium text-zinc-950">
										{transaction.payee || transaction.categoryName || m.uncategorized()}
									</p>
									<p class="mt-1 text-sm text-zinc-500">
										{formatDate(transaction.bookingDate)} / {transaction.accountName}
									</p>
								</div>
								<p class="font-medium text-zinc-950">{centsToEuros(transaction.amountCents)}</p>
							</div>
						{/each}
					{/if}
				</div>
			</article>

			<article class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
				<h2 class="text-lg font-semibold text-zinc-950">{m.cashflow_this_month()}</h2>
				<div class="mt-4 grid gap-3 sm:grid-cols-3">
					<div class="rounded-ui bg-zinc-50 p-3">
						<p class="text-xs font-medium text-zinc-500">{m.actual_income()}</p>
						<p class="mt-1 font-semibold text-emerald-700">
							{centsToEuros(monthCashflow?.actual.incomeCents ?? 0)}
						</p>
					</div>
					<div class="rounded-ui bg-zinc-50 p-3">
						<p class="text-xs font-medium text-zinc-500">{m.actual_expenses()}</p>
						<p class="mt-1 font-semibold text-zinc-950">
							{centsToEuros(monthCashflow?.actual.expenseCents ?? 0)}
						</p>
					</div>
					<div class="rounded-ui bg-zinc-50 p-3">
						<p class="text-xs font-medium text-zinc-500">{m.actual_net()}</p>
						<p class="mt-1 font-semibold text-zinc-950">
							{centsToEuros(monthCashflow?.actual.netCents ?? 0)}
						</p>
					</div>
				</div>
				{#if (monthCashflow?.actual.incomeCents ?? 0) === 0 && (monthCashflow?.actual.expenseCents ?? 0) === 0}
					<p class="mt-3 text-sm text-zinc-500">{m.no_actual_cashflow()}</p>
				{/if}
				<div class="mt-5 border-t border-zinc-200 pt-4">
					<div class="grid gap-3 sm:grid-cols-3">
						<div>
							<p class="text-xs font-medium text-zinc-500">{m.forecast_income()}</p>
							<p class="mt-1 font-semibold text-emerald-700">
								{centsToEuros(monthCashflow?.forecast.incomeCents ?? 0)}
							</p>
						</div>
						<div>
							<p class="text-xs font-medium text-zinc-500">{m.forecast_payments()}</p>
							<p class="mt-1 font-semibold text-zinc-950">
								{centsToEuros(monthCashflow?.forecast.paymentCents ?? 0)}
							</p>
						</div>
						<div>
							<p class="text-xs font-medium text-zinc-500">{m.projected_month_net()}</p>
							<p class="mt-1 font-semibold text-zinc-950">
								{centsToEuros(monthCashflow?.projectedNetCents ?? 0)}
							</p>
						</div>
					</div>
				</div>
				<div class="mt-4 grid gap-4 sm:grid-cols-2">
					<div>
						<h3 class="text-sm font-semibold text-zinc-700">{m.upcoming_payments()}</h3>
						<div class="mt-2 divide-y divide-zinc-200">
							{#if (monthCashflow?.upcomingPayments.length ?? 0) === 0}
								<p class="py-3 text-sm text-zinc-500">{m.no_upcoming_payments()}</p>
							{:else}
								{#each monthCashflow?.upcomingPayments ?? [] as payment (payment.id)}
									<div class="flex justify-between gap-3 py-3 text-sm">
										<span class="text-zinc-700">{payment.payee}</span>
										<span class="font-medium text-zinc-950"
											>{centsToEuros(payment.amountCents)}</span
										>
									</div>
								{/each}
							{/if}
						</div>
					</div>
					<div>
						<h3 class="text-sm font-semibold text-zinc-700">{m.upcoming_income()}</h3>
						<div class="mt-2 divide-y divide-zinc-200">
							{#if (monthCashflow?.upcomingIncome.length ?? 0) === 0}
								<p class="py-3 text-sm text-zinc-500">{m.no_upcoming_income()}</p>
							{:else}
								{#each monthCashflow?.upcomingIncome ?? [] as income (income.id)}
									<div class="flex justify-between gap-3 py-3 text-sm">
										<span class="text-zinc-700">{income.payer}</span>
										<span class="font-medium text-zinc-950">{centsToEuros(income.amountCents)}</span
										>
									</div>
								{/each}
							{/if}
						</div>
					</div>
				</div>
			</article>
		</section>
	</section>
</main>
