<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type {
		CategoryCostProjectionReport,
		MonthCashflowReport,
		UpcomingIncome
	} from '$lib/cashflow';
	import { buildAccountScopeOptions, buildAccountScopeQuery } from '$lib/account-scope';
	import { BarChart, LineChart } from 'layerchart/svg';
	import { onMount } from 'svelte';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import Picker from '$lib/components/Picker.svelte';
	import ErrorAlert from '$lib/components/ErrorAlert.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	interface AccountWithBalance {
		id: string;
		name: string;
		institution: string | null;
		balanceCents: number | null;
		balanceInitialized: boolean;
	}

	interface DashboardCategory {
		id: string;
		name: string;
		type: string;
		color: string | null;
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
		byAccount: Array<{
			accountId: string;
			accountName: string;
			balanceCents: number | null;
			balanceInitialized: boolean;
		}>;
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
		accounts: Array<{
			accountId: string;
			accountName: string;
			balanceCents: number | null;
			balanceInitialized: boolean;
		}>;
		liabilities: Array<{ id: string; name: string; amountCents: number; asOfDate: string }>;
	}

	interface BalanceProjection {
		asOf: string;
		projectionDate: string;
		currentBalanceCents: number;
		upcomingPaymentCents: number;
		projectedBalanceCents: number;
		uninitializedAccountIds: string[];
		nextIncome: UpcomingIncome | null;
	}

	let accounts = $state<AccountWithBalance[]>([]);
	let projectionCategories = $state<DashboardCategory[]>([]);
	let summary = $state<SummaryReport | null>(null);
	let netWorth = $state<NetWorthReport | null>(null);
	let monthCashflow = $state<MonthCashflowReport | null>(null);
	let projection = $state<BalanceProjection | null>(null);
	let categoryProjection = $state<CategoryCostProjectionReport | null>(null);
	let selectedProjectionCategoryIds = $state<string[]>([]);
	let isCategoryProjectionExpanded = $state(false);
	let isCategoryProjectionLoading = $state(false);
	let categoryProjectionError = $state<string | null>(null);
	let isDashboardLoading = $state(true);
	let dashboardError = $state<string | null>(null);
	let dashboardAccountScope = $state('');
	let includeLiabilitiesInNetWorth = $state(false);
	let prefersReducedMotion = $state(false);
	let categoryProjectionRequestId = 0;
	const categoryProjectionStorageKey = 'finance-tracker.category-projection.selection.v1';

	const netWorthChartTween = { type: 'tween', duration: 450 } as const;
	const netWorthChartMotion = $derived(
		prefersReducedMotion ? ('none' as const) : netWorthChartTween
	);

	const netWorthPoints = $derived(
		netWorth?.points.map((point) => ({
			date: new Date(`${point.date}T00:00:00.000Z`),
			netWorthCents: (includeLiabilitiesInNetWorth ? point.netWorthCents : point.assetsCents) / 100
		})) ?? []
	);
	const totalAccountBalanceCents = $derived(
		netWorth?.accounts.reduce((sum, account) => sum + (account.balanceCents ?? 0), 0) ??
			accounts.reduce((sum, account) => sum + (account.balanceCents ?? 0), 0)
	);
	const uninitializedAccountCount = $derived(
		accounts.filter((account) => !account.balanceInitialized).length
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
	const categoryProjectionChartData = $derived(
		categoryProjection?.categories.map((category) => ({
			category: category.categoryName,
			actual: category.actualCents / 100,
			remaining: category.projectedRemainingCents / 100
		})) ?? []
	);
	const categoryProjectionXAxisMax = $derived(
		Math.max(
			1,
			...(categoryProjection?.categories.map((category) => category.projectedCents / 100) ?? [])
		)
	);

	onMount(() => {
		void loadHomeState();

		const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const updateReducedMotionPreference = () => {
			prefersReducedMotion = reducedMotionQuery.matches;
		};

		updateReducedMotionPreference();
		reducedMotionQuery.addEventListener('change', updateReducedMotionPreference);

		return () => {
			reducedMotionQuery.removeEventListener('change', updateReducedMotionPreference);
		};
	});

	async function loadHomeState() {
		const [, categoriesLoaded] = await Promise.all([loadAccounts(), loadProjectionCategories()]);
		await loadDashboard();
		if (categoriesLoaded) await loadCategoryProjection();
	}

	async function loadAccounts() {
		try {
			const payload = await fetchJson<{ accounts: AccountWithBalance[] }>('/api/accounts');
			accounts = payload.accounts;
		} catch {
			accounts = [];
		}
	}

	async function loadProjectionCategories() {
		try {
			const payload = await fetchJson<{ categories: DashboardCategory[] }>('/api/categories');
			projectionCategories = payload.categories.filter(
				(category) => category.type === 'expense' || category.type === 'unknown'
			);
			const availableIds = new Set(projectionCategories.map((category) => category.id));
			selectedProjectionCategoryIds = readStoredProjectionCategories().filter((categoryId) =>
				availableIds.has(categoryId)
			);
			storeProjectionCategories();
			return true;
		} catch {
			projectionCategories = [];
			selectedProjectionCategoryIds = [];
			categoryProjectionError = m.category_projection_load_error();
			return false;
		}
	}

	async function loadDashboard() {
		isDashboardLoading = true;
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
				dashboardError = m.dashboard_load_error();
			}
		} catch {
			dashboardError = m.dashboard_load_error();
		} finally {
			isDashboardLoading = false;
		}
	}

	async function loadCategoryProjection() {
		const requestId = ++categoryProjectionRequestId;
		categoryProjectionError = null;
		if (selectedProjectionCategoryIds.length === 0) {
			categoryProjection = null;
			isCategoryProjectionLoading = false;
			return;
		}

		isCategoryProjectionLoading = true;
		const params = new URLSearchParams();
		for (const categoryId of selectedProjectionCategoryIds) {
			params.append('categoryId', categoryId);
		}
		if (dashboardAccountScope) params.set('accountId', dashboardAccountScope);

		try {
			const payload = await fetchJson<{ projection: CategoryCostProjectionReport }>(
				`/api/category-cost-projection?${params.toString()}`
			);
			if (requestId === categoryProjectionRequestId) categoryProjection = payload.projection;
		} catch {
			if (requestId === categoryProjectionRequestId) {
				categoryProjectionError = m.category_projection_load_error();
			}
		} finally {
			if (requestId === categoryProjectionRequestId) isCategoryProjectionLoading = false;
		}
	}

	function toggleProjectionCategory(categoryId: string) {
		selectedProjectionCategoryIds = selectedProjectionCategoryIds.includes(categoryId)
			? selectedProjectionCategoryIds.filter((selectedId) => selectedId !== categoryId)
			: [...selectedProjectionCategoryIds, categoryId];
		storeProjectionCategories();
		void loadCategoryProjection();
	}

	function clearProjectionCategories() {
		selectedProjectionCategoryIds = [];
		storeProjectionCategories();
		void loadCategoryProjection();
	}

	function readStoredProjectionCategories(): string[] {
		try {
			const value = JSON.parse(localStorage.getItem(categoryProjectionStorageKey) ?? '[]');
			return Array.isArray(value)
				? value.filter((item): item is string => typeof item === 'string')
				: [];
		} catch {
			return [];
		}
	}

	function storeProjectionCategories() {
		localStorage.setItem(
			categoryProjectionStorageKey,
			JSON.stringify(selectedProjectionCategoryIds)
		);
	}

	function handleDashboardScopeChange() {
		void Promise.all([loadDashboard(), loadCategoryProjection()]);
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

	function formatMonth(value: string): string {
		return new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, {
			month: 'long',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>{m.app_title()}</title>
	<meta name="description" content={m.app_subtitle()} />
</svelte:head>

<main class="mx-auto max-w-[90rem] px-6 pb-[50px] pt-6 lg:pt-8">
	<section class="mt-4 grid gap-6">
		{#if dashboardError}
			<ErrorAlert message={dashboardError} retry={loadDashboard} retryLabel={m.retry()} />
		{/if}
		<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			<article class="rounded-ui border border-zinc-200 bg-white p-4">
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
						onchange={handleDashboardScopeChange}
					/>
				</div>
			</article>
			<article
				class="rounded-ui border border-zinc-200 bg-white p-4"
				aria-busy={isDashboardLoading}
			>
				<p class="text-sm font-medium text-zinc-500">{m.total_balance()}</p>
				{#if isDashboardLoading}
					<Skeleton class="mt-2 h-8 w-36" />
				{:else}
					<p class="mt-2 text-2xl font-semibold text-zinc-950">
						{netWorth || accounts.length > 0 ? centsToEuros(totalAccountBalanceCents) : '—'}
					</p>
				{/if}
				{#if uninitializedAccountCount > 0}
					<p class="mt-1 text-xs text-amber-700">
						{m.uninitialized_accounts({ count: uninitializedAccountCount })}
					</p>
				{/if}
			</article>
			<article
				class="rounded-ui border border-zinc-200 bg-white p-4"
				aria-busy={isDashboardLoading}
			>
				<p class="text-sm font-medium text-zinc-500">{m.month_net()}</p>
				{#if isDashboardLoading}
					<Skeleton class="mt-2 h-8 w-28" />
				{:else}
					<p class="mt-2 text-2xl font-semibold text-zinc-950">
						{monthCashflow ? centsToEuros(monthCashflow.actual.netCents) : '—'}
					</p>
				{/if}
			</article>
			<article
				class="rounded-ui border border-zinc-200 bg-white p-4"
				aria-busy={isDashboardLoading}
			>
				<p class="text-sm font-medium text-zinc-500">{m.balance_before_next_income()}</p>
				{#if isDashboardLoading}
					<Skeleton class="mt-2 h-8 w-32" />
					<Skeleton class="mt-2 h-4 w-24" />
				{:else}
					<p class="mt-2 text-2xl font-semibold text-zinc-950">
						{projection ? centsToEuros(projection.projectedBalanceCents) : '—'}
					</p>
					<p class="mt-1 text-xs text-zinc-500">
						{m.projection_date()}: {formatDate(projection?.projectionDate ?? null)}
					</p>
				{/if}
				{#if projection && projection.uninitializedAccountIds.length > 0}
					<p class="mt-1 text-xs text-amber-700">{m.balance_projection_incomplete()}</p>
				{/if}
			</article>
		</div>

		<section class="rounded-ui border border-zinc-200 bg-white p-5" aria-busy={isDashboardLoading}>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 class="text-lg font-semibold text-zinc-950">{m.net_worth()}</h2>
					<p class="mt-1 text-sm text-zinc-500">
						{summary?.range.from ?? ''} - {summary?.range.to ?? ''}
					</p>
				</div>
				{#if (netWorth?.liabilities.length ?? 0) > 0}
					<div class="flex items-center gap-3 text-sm font-medium text-zinc-700">
						<span>{m.include_liabilities()}</span>
						<button
							type="button"
							role="switch"
							class={`relative h-[22px] w-14 shrink-0 rounded-full transition-colors duration-300 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${includeLiabilitiesInNetWorth ? 'bg-[#4fbf26]' : 'bg-[#ccc]'}`}
							aria-label={m.include_liabilities()}
							aria-checked={includeLiabilitiesInNetWorth}
							onclick={() => (includeLiabilitiesInNetWorth = !includeLiabilitiesInNetWorth)}
						>
							<span
								class={`absolute left-0.5 top-0.5 z-10 h-[18px] w-[30px] rounded-full bg-white transition-transform duration-300 motion-reduce:transition-none ${includeLiabilitiesInNetWorth ? 'translate-x-[22px]' : 'translate-x-0'}`}
								aria-hidden="true"
							></span>
							<span
								data-toggle-symbol="on"
								class={`absolute left-0.5 top-0 z-0 flex h-[22px] w-[22px] items-center justify-center text-[11px] font-bold leading-none text-white transition-opacity duration-300 motion-reduce:transition-none ${includeLiabilitiesInNetWorth ? 'opacity-100' : 'opacity-0'}`}
								aria-hidden="true">I</span
							>
							<span
								data-toggle-symbol="off"
								class={`absolute left-8 top-0 z-0 flex h-[22px] w-[22px] items-center justify-center text-[11px] font-bold leading-none text-zinc-700 transition-opacity duration-300 motion-reduce:transition-none ${includeLiabilitiesInNetWorth ? 'opacity-0' : 'opacity-100'}`}
								aria-hidden="true">O</span
							>
						</button>
					</div>
				{/if}
			</div>
			<div class="mt-5 h-72 p-4">
				{#if isDashboardLoading}
					<Skeleton class="h-full w-full" rounded="rounded-ui" />
				{:else if netWorthPoints.length > 0}
					<LineChart
						data={netWorthPoints}
						x="date"
						y="netWorthCents"
						height={240}
						axis
						grid
						motion={netWorthChartMotion}
						props={{
							xAxis: { tickSpacing: 110 },
							yAxis: { motion: netWorthChartMotion },
							grid: { motion: netWorthChartMotion },
							rule: { motion: netWorthChartMotion },
							spline: { motion: netWorthChartMotion }
						}}
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

		<section
			class="rounded-ui border border-zinc-200 bg-white"
			aria-busy={isCategoryProjectionLoading}
		>
			<button
				type="button"
				class="flex w-full items-center justify-between gap-4 rounded-ui p-5 text-left transition hover:bg-zinc-50 focus:outline-2 focus:outline-offset-2 focus:outline-blue-500/20"
				aria-expanded={isCategoryProjectionExpanded}
				aria-controls="category-cost-projection-details"
				aria-label={isCategoryProjectionExpanded
					? m.category_projection_collapse()
					: m.category_projection_expand()}
				onclick={() => (isCategoryProjectionExpanded = !isCategoryProjectionExpanded)}
			>
				<span>
					<span class="block text-sm font-medium text-zinc-500">
						{m.category_cost_projection()}
					</span>
					{#if isCategoryProjectionLoading}
						<Skeleton class="mt-2 h-8 w-36" />
					{:else}
						<span class="mt-2 block text-2xl font-semibold text-zinc-950">
							{selectedProjectionCategoryIds.length > 0 && categoryProjection
								? centsToEuros(categoryProjection.totals.projectedCents)
								: '—'}
						</span>
					{/if}
					<span class="mt-1 block text-xs text-zinc-500">
						{#if selectedProjectionCategoryIds.length === 0}
							{m.category_projection_select_prompt()}
						{:else}
							{formatMonth(
								categoryProjection?.range.from.slice(0, 7) ??
									summary?.range.to.slice(0, 7) ??
									new Date().toISOString().slice(0, 7)
							)} / {m.category_projection_selected_count({
								count: selectedProjectionCategoryIds.length
							})}
						{/if}
					</span>
				</span>
				<svg
					class={`size-6 shrink-0 text-zinc-500 transition-transform ${isCategoryProjectionExpanded ? 'rotate-180' : ''}`}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</button>

			{#if isCategoryProjectionExpanded}
				<div id="category-cost-projection-details" class="border-t border-zinc-200 p-5">
					<fieldset>
						<legend class="text-sm font-semibold text-zinc-700">
							{m.category_projection_select_prompt()}
						</legend>
						<div class="mt-2 flex justify-end">
							<button
								type="button"
								class="text-sm font-medium text-blue-700 hover:text-blue-900 disabled:cursor-not-allowed disabled:text-zinc-400"
								disabled={selectedProjectionCategoryIds.length === 0}
								onclick={clearProjectionCategories}
							>
								{m.category_projection_clear()}
							</button>
						</div>
						<div class="mt-3 flex flex-wrap gap-2">
							{#each projectionCategories as category (category.id)}
								<label
									class={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${selectedProjectionCategoryIds.includes(category.id) ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'}`}
								>
									<input
										class="rounded border-zinc-300 text-blue-700 focus:ring-blue-500"
										type="checkbox"
										checked={selectedProjectionCategoryIds.includes(category.id)}
										onchange={() => toggleProjectionCategory(category.id)}
									/>
									<span
										class="size-2 rounded-full"
										style={`background-color: ${category.color ?? '#71717a'}`}
										aria-hidden="true"
									></span>
									{category.name}
								</label>
							{/each}
						</div>
					</fieldset>

					{#if categoryProjectionError}
						<div class="mt-5">
							<ErrorAlert
								message={categoryProjectionError}
								retry={loadCategoryProjection}
								retryLabel={m.retry()}
							/>
						</div>
					{:else if isCategoryProjectionLoading}
						<div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
							{#each Array(4) as _}
								<Skeleton class="h-20 w-full" rounded="rounded-ui" />
							{/each}
						</div>
						<Skeleton class="mt-5 h-72 w-full" rounded="rounded-ui" />
					{:else if selectedProjectionCategoryIds.length === 0}
						<p
							class="mt-5 rounded-ui border border-dashed border-zinc-300 p-6 text-sm text-zinc-500"
						>
							{m.category_projection_empty()}
						</p>
					{:else if categoryProjection}
						<div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
							<div class="rounded-ui bg-zinc-50 p-3">
								<p class="text-xs font-medium text-zinc-500">{m.category_projection_actual()}</p>
								<p class="mt-1 font-semibold text-zinc-950">
									{centsToEuros(categoryProjection.totals.actualCents)}
								</p>
							</div>
							<div class="rounded-ui bg-zinc-50 p-3">
								<p class="text-xs font-medium text-zinc-500">
									{m.category_projection_historical_average()}
								</p>
								<p class="mt-1 font-semibold text-zinc-950">
									{centsToEuros(categoryProjection.totals.historicalAverageCents)}
								</p>
							</div>
							<div class="rounded-ui bg-zinc-50 p-3">
								<p class="text-xs font-medium text-zinc-500">
									{m.category_projection_planned_remaining()}
								</p>
								<p class="mt-1 font-semibold text-zinc-950">
									{centsToEuros(categoryProjection.totals.plannedRemainingCents)}
								</p>
							</div>
							<div class="rounded-ui bg-emerald-50 p-3">
								<p class="text-xs font-medium text-emerald-700">
									{m.category_projection_month_total()}
								</p>
								<p class="mt-1 font-semibold text-emerald-800">
									{centsToEuros(categoryProjection.totals.projectedCents)}
								</p>
							</div>
						</div>
						<p class="mt-3 text-xs text-zinc-500">
							{m.category_projection_history_basis({
								months: categoryProjection.range.historyMonths.map(formatMonth).join(' – ')
							})}
						</p>

						<div class="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(30rem,0.9fr)]">
							<div class="min-w-0 rounded-ui bg-zinc-50 p-3">
								<div class="flex flex-wrap gap-4 px-2 text-xs text-zinc-600">
									<span class="flex items-center gap-2">
										<span class="size-3 rounded-sm bg-emerald-700" aria-hidden="true"></span>
										{m.category_projection_actual()}
									</span>
									<span class="flex items-center gap-2">
										<span class="size-3 rounded-sm bg-blue-300" aria-hidden="true"></span>
										{m.category_projection_projected_remaining()}
									</span>
								</div>
								<div
									class="category-projection-chart mt-3 min-h-64 p-4"
									style={`height: ${Math.max(260, categoryProjectionChartData.length * 56)}px`}
								>
									<BarChart
										data={categoryProjectionChartData}
										orientation="horizontal"
										x="actual"
										y="category"
										xDomain={[0, categoryProjectionXAxisMax]}
										padding={{ left: 120 }}
										axis
										grid
										seriesLayout="stack"
										series={[
											{ key: 'actual', value: 'actual', color: '#047857' },
											{ key: 'remaining', value: 'remaining', color: '#93c5fd' }
										]}
										class="h-full w-full"
									/>
								</div>
							</div>

							<div class="min-w-0 overflow-x-auto rounded-ui border border-zinc-200">
								<table class="w-full min-w-[42rem] text-left text-sm">
									<thead class="bg-zinc-50 text-xs font-semibold text-zinc-600">
										<tr>
											<th class="px-3 py-3" scope="col">{m.category()}</th>
											<th class="px-3 py-3 text-right" scope="col">
												{m.category_projection_actual()}
											</th>
											<th class="px-3 py-3 text-right" scope="col">
												{m.category_projection_historical_average()}
											</th>
											<th class="px-3 py-3 text-right" scope="col">
												{m.category_projection_planned_remaining()}
											</th>
											<th class="px-3 py-3 text-right" scope="col">
												{m.category_projection_month_total()}
											</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-zinc-200">
										{#each categoryProjection.categories as category (category.categoryId)}
											<tr>
												<th class="px-3 py-3 font-medium text-zinc-950" scope="row">
													<span class="flex items-center gap-2">
														<span
															class="size-2 rounded-full"
															style={`background-color: ${category.categoryColor ?? '#71717a'}`}
															aria-hidden="true"
														></span>
														{category.categoryName}
													</span>
												</th>
												<td class="px-3 py-3 text-right text-zinc-700">
													{centsToEuros(category.actualCents)}
												</td>
												<td class="px-3 py-3 text-right text-zinc-700">
													{centsToEuros(category.historicalAverageCents)}
												</td>
												<td class="px-3 py-3 text-right text-zinc-700">
													{centsToEuros(category.plannedRemainingCents)}
												</td>
												<td class="px-3 py-3 text-right font-semibold text-zinc-950">
													{centsToEuros(category.projectedCents)}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<section class="rounded-ui border border-zinc-200 bg-white p-5" aria-busy={isDashboardLoading}>
			<div>
				<h2 class="text-lg font-semibold text-zinc-950">{m.expenses_by_category()}</h2>
				<p class="mt-1 text-sm text-zinc-500">
					{expenseMonths[0]?.label} – {expenseMonths[2]?.label}
				</p>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-3">
				{#if isDashboardLoading}
					{#each Array(3) as _}
						<Skeleton class="h-80 w-full" rounded="rounded-ui" />
					{/each}
				{:else}
					{#each expenseCategoryPoints as month (month.month)}
						<article class="min-w-0 rounded-ui bg-zinc-50 p-3">
							<h3 class="font-medium text-zinc-950">{month.label}</h3>
							<div class="expense-category-chart mt-3 h-72 p-4">
								{#if month.categories.some((category) => category.expense > 0)}
									<BarChart
										data={month.categories}
										orientation="horizontal"
										x="expense"
										y="category"
										xDomain={[0, expenseYAxisMax]}
										padding={{ left: 104 }}
										axis
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
				{/if}
			</div>
		</section>

		<section class="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
			<article
				class="rounded-ui border border-zinc-200 bg-white p-5"
				aria-busy={isDashboardLoading}
			>
				<h2 class="text-lg font-semibold text-zinc-950">{m.recent_transactions()}</h2>
				<div class="mt-4 divide-y divide-zinc-200">
					{#if isDashboardLoading}
						{#each Array(4) as _}
							<div class="grid grid-cols-[1fr_auto] gap-3 py-3">
								<div class="space-y-2">
									<Skeleton class="h-5 w-40" />
									<Skeleton class="h-4 w-28" />
								</div>
								<Skeleton class="h-5 w-20" />
							</div>
						{/each}
					{:else if (summary?.recentTransactions.length ?? 0) === 0}
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

			<article
				class="rounded-ui border border-zinc-200 bg-white p-5"
				aria-busy={isDashboardLoading}
			>
				<h2 class="text-lg font-semibold text-zinc-950">{m.cashflow_this_month()}</h2>
				{#if isDashboardLoading}
					<div class="mt-4 grid gap-3 sm:grid-cols-3">
						{#each Array(3) as _}
							<Skeleton class="h-20 w-full" rounded="rounded-ui" />
						{/each}
					</div>
					<Skeleton class="mt-5 h-32 w-full" rounded="rounded-ui" />
				{:else}
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
											<span class="font-medium text-zinc-950"
												>{centsToEuros(income.amountCents)}</span
											>
										</div>
									{/each}
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</article>
		</section>
	</section>
</main>

<style>
	:global(.expense-category-chart .lc-axis-tick-label) {
		font-size: 12px !important;
		font-weight: 500 !important;
	}

	:global(.category-projection-chart .lc-axis-tick-label) {
		font-size: 12px !important;
		font-weight: 500 !important;
	}
</style>
