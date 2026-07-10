<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { LineChart } from 'layerchart/svg';
	import { onMount } from 'svelte';

	type BankId = 'n26' | 'trade_republic' | 'dkb';

	interface AccountWithProfile {
		id: string;
		name: string;
		institution: string | null;
		openingBalanceCents: number;
		currentBalanceCents: number | null;
		profile: { id: string; bankId: BankId; label: string } | null;
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

	interface UpcomingPayment {
		id: string;
		payee: string;
		amountCents: number;
		dueDate: string;
	}

	interface UpcomingIncome {
		id: string;
		payer: string;
		amountCents: number;
		dueDate: string;
	}

	interface BalanceProjection {
		asOf: string;
		projectionDate: string;
		currentBalanceCents: number;
		upcomingPaymentCents: number;
		projectedBalanceCents: number;
		nextIncome: UpcomingIncome | null;
	}

	const bankOptions: Array<{ id: BankId; label: string }> = [
		{ id: 'dkb', label: 'DKB' },
		{ id: 'n26', label: 'N26' },
		{ id: 'trade_republic', label: 'Trade Republic' }
	];

	let accounts = $state<AccountWithProfile[]>([]);
	let summary = $state<SummaryReport | null>(null);
	let netWorth = $state<NetWorthReport | null>(null);
	let upcomingPayments = $state<UpcomingPayment[]>([]);
	let upcomingIncome = $state<UpcomingIncome[]>([]);
	let projection = $state<BalanceProjection | null>(null);
	let status = $state(m.setup_status_loading());
	let dashboardStatus = $state(m.dashboard_status_loading());
	let error = $state<string | null>(null);
	let dashboardError = $state<string | null>(null);
	let accountName = $state('');
	let institution = $state('');
	let openingBalance = $state('0.00');
	let profileAccountId = $state('');
	let profileLabel = $state('');
	let profileBankId = $state<BankId>('dkb');
	let dashboardAccountId = $state('');
	let isSaving = $state(false);

	const netWorthPoints = $derived(
		netWorth?.points.map((point) => ({
			date: point.date,
			netWorthCents: point.netWorthCents / 100
		})) ?? []
	);
	const totalAccountBalanceCents = $derived(
		netWorth?.accounts.reduce((sum, account) => sum + account.balanceCents, 0) ??
			accounts.reduce(
				(sum, account) => sum + (account.currentBalanceCents ?? account.openingBalanceCents),
				0
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
		status = m.setup_status_loading();
		error = null;

		try {
			const payload = await fetchJson<{ accounts: AccountWithProfile[] }>('/api/accounts');
			accounts = payload.accounts;
			profileAccountId = profileAccountId || payload.accounts[0]?.id || '';
			status = m.setup_status_ready();
		} catch {
			status = m.setup_status_error();
			error = m.setup_status_error();
		}
	}

	async function loadDashboard() {
		dashboardStatus = m.dashboard_status_loading();
		dashboardError = null;

		try {
			const reportQuery = buildDashboardReportQuery();
			const summaryPayload = await fetchJson<{ summary: SummaryReport }>(
				`/api/summary${reportQuery}`
			);
			const netWorthPayload = await fetchJson<{ netWorth: NetWorthReport }>(
				`/api/net-worth${reportQuery}`
			);
			const paymentsPayload = await fetchJson<{ upcomingPayments: UpcomingPayment[] }>(
				`/api/upcoming-payments${reportQuery}`
			);
			const incomePayload = await fetchJson<{ upcomingIncome: UpcomingIncome[] }>(
				`/api/upcoming-income${reportQuery}`
			);
			const projectionPayload = await fetchJson<{ projection: BalanceProjection }>(
				`/api/balance-before-salary${reportQuery}`
			);

			summary = summaryPayload.summary;
			netWorth = netWorthPayload.netWorth;
			upcomingPayments = paymentsPayload.upcomingPayments;
			upcomingIncome = incomePayload.upcomingIncome;
			projection = projectionPayload.projection;
			dashboardStatus = m.dashboard_status_ready();
		} catch {
			dashboardStatus = m.dashboard_status_error();
			dashboardError = m.dashboard_status_error();
		}
	}

	async function applyDashboardAccountFilter() {
		await loadDashboard();
	}

	async function createAccount(event: SubmitEvent) {
		event.preventDefault();
		isSaving = true;
		error = null;

		try {
			await fetchJson('/api/accounts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: accountName,
					institution: institution || null,
					openingBalanceCents: eurosToCents(openingBalance)
				})
			});

			accountName = '';
			institution = '';
			openingBalance = '0.00';
			status = m.setup_status_saved();
			await loadHomeState();
		} catch {
			status = m.setup_status_error();
			error = m.setup_status_error();
		} finally {
			isSaving = false;
		}
	}

	async function createProfile(event: SubmitEvent) {
		event.preventDefault();
		isSaving = true;
		error = null;

		try {
			await fetchJson('/api/profiles', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: profileAccountId,
					bankId: profileBankId,
					label: profileLabel
				})
			});

			profileLabel = '';
			status = m.setup_status_saved();
			await loadAccounts();
		} catch {
			status = m.setup_status_error();
			error = m.setup_status_error();
		} finally {
			isSaving = false;
		}
	}

	async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
		if (!response.ok) {
			throw new Error(await response.text());
		}

		return (await response.json()) as T;
	}

	function eurosToCents(value: string): number {
		const normalized = value.trim().replace(',', '.');
		const parsed = Number.parseFloat(normalized);
		return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
	}

	function buildDashboardReportQuery(): string {
		return dashboardAccountId ? `?accountId=${encodeURIComponent(dashboardAccountId)}` : '';
	}

	function getAccountBalanceCents(account: AccountWithProfile): number {
		return (
			netWorth?.accounts.find((balance) => balance.accountId === account.id)?.balanceCents ??
			account.currentBalanceCents ??
			account.openingBalanceCents
		);
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

<main class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:py-8">
	<section class="space-y-5 lg:col-span-2">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 class="text-3xl font-semibold tracking-normal text-zinc-950 sm:text-4xl">
					{m.app_title()}
				</h1>
				<p class="mt-2 max-w-3xl text-base leading-7 text-zinc-700">{m.app_subtitle()}</p>
			</div>
			<div class="flex flex-col items-start gap-3 sm:items-end">
				<p class="text-sm text-zinc-500">{dashboardStatus}</p>
				<form
					class="flex flex-col gap-2 sm:flex-row sm:items-end"
					onsubmit={applyDashboardAccountFilter}
				>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.dashboard_account_scope()}</span>
						<select
							class="min-w-48 rounded border-zinc-300"
							aria-label={m.dashboard_account_scope()}
							bind:value={dashboardAccountId}
						>
							<option value="">{m.all_accounts()}</option>
							{#each accounts as account (account.id)}
								<option value={account.id}>{account.name}</option>
							{/each}
						</select>
					</label>
					<button
						class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
						type="submit"
					>
						{m.apply_scope()}
					</button>
				</form>
			</div>
		</div>

		{#if dashboardError}
			<p class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
				{dashboardError}
			</p>
		{/if}
	</section>

	<section class="grid gap-6">
		<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-sm font-medium text-zinc-500">{m.total_balance()}</p>
				<p class="mt-2 text-2xl font-semibold text-zinc-950">
					{centsToEuros(totalAccountBalanceCents)}
				</p>
			</article>
			<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-sm font-medium text-zinc-500">{m.month_net()}</p>
				<p class="mt-2 text-2xl font-semibold text-zinc-950">
					{centsToEuros(summary?.totals.netCents ?? 0)}
				</p>
			</article>
			<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-sm font-medium text-zinc-500">{m.unknown_transactions()}</p>
				<p class="mt-2 text-2xl font-semibold text-zinc-950">
					{summary?.totals.unknownCount ?? 0}
				</p>
			</article>
			<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-sm font-medium text-zinc-500">{m.balance_before_salary()}</p>
				<p class="mt-2 text-2xl font-semibold text-zinc-950">
					{centsToEuros(projection?.projectedBalanceCents ?? 0)}
				</p>
				<p class="mt-1 text-xs text-zinc-500">
					{m.projection_date()}: {formatDate(projection?.projectionDate ?? null)}
				</p>
			</article>
		</div>

		<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<div>
				<h2 class="text-lg font-semibold text-zinc-950">{m.net_worth()}</h2>
				<p class="mt-1 text-sm text-zinc-500">
					{summary?.range.from ?? ''} - {summary?.range.to ?? ''}
				</p>
			</div>
			<div class="mt-5 h-64">
				{#if netWorthPoints.length > 0}
					<LineChart
						data={netWorthPoints}
						x="date"
						y="netWorthCents"
						height={240}
						axis
						grid
						class="h-full w-full text-emerald-700"
					/>
				{:else}
					<div
						class="flex h-full items-center justify-center rounded border border-dashed border-zinc-300"
					>
						<p class="text-sm text-zinc-500">{m.no_chart_data()}</p>
					</div>
				{/if}
			</div>
		</section>

		<section class="grid gap-6 xl:grid-cols-2">
			<article class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
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

			<article class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
				<h2 class="text-lg font-semibold text-zinc-950">{m.cashflow_this_month()}</h2>
				<div class="mt-4 grid gap-4 sm:grid-cols-2">
					<div>
						<h3 class="text-sm font-semibold text-zinc-700">{m.upcoming_payments()}</h3>
						<div class="mt-2 divide-y divide-zinc-200">
							{#if upcomingPayments.length === 0}
								<p class="py-3 text-sm text-zinc-500">{m.no_upcoming_payments()}</p>
							{:else}
								{#each upcomingPayments as payment (payment.id)}
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
							{#if upcomingIncome.length === 0}
								<p class="py-3 text-sm text-zinc-500">{m.no_upcoming_income()}</p>
							{:else}
								{#each upcomingIncome as income (income.id)}
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

	<aside class="space-y-6">
		<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<div class="flex items-center justify-between gap-4">
				<h2 class="text-lg font-semibold text-zinc-950">{m.setup_title()}</h2>
				<p class="text-sm text-zinc-500">{status}</p>
			</div>

			<form class="mt-5 grid gap-4" onsubmit={createAccount}>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.account_name()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={accountName} required />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.institution()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={institution} />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.opening_balance()}</span>
					<input
						class="w-full rounded border-zinc-300"
						inputmode="decimal"
						bind:value={openingBalance}
					/>
				</label>
				<button
					class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					type="submit"
					disabled={isSaving}
				>
					{m.create_account()}
				</button>
			</form>

			<form class="mt-8 grid gap-4 border-t border-zinc-200 pt-5" onsubmit={createProfile}>
				<h3 class="text-base font-semibold text-zinc-950">{m.profile_title()}</h3>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.account()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={profileAccountId} required>
						<option value="">{m.required()}</option>
						{#each accounts as account (account.id)}
							<option value={account.id}>{account.name}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.bank()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={profileBankId}>
						{#each bankOptions as bank (bank.id)}
							<option value={bank.id}>{bank.label}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.profile_label()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={profileLabel} required />
				</label>
				<button
					class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
					type="submit"
					disabled={isSaving || accounts.length === 0}
				>
					{m.create_profile()}
				</button>
			</form>

			{#if error}
				<p class="mt-4 text-sm text-red-700">{error}</p>
			{/if}
		</section>

		<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.accounts()}</h2>
			<div class="mt-5 divide-y divide-zinc-200">
				{#if accounts.length === 0}
					<p class="py-4 text-sm text-zinc-500">{m.no_accounts()}</p>
				{:else}
					{#each accounts as account (account.id)}
						<article class="py-4">
							<div class="flex items-start justify-between gap-4">
								<div>
									<h3 class="text-base font-semibold text-zinc-950">{account.name}</h3>
									<p class="mt-1 text-sm text-zinc-600">
										{account.institution || m.institution()} / {centsToEuros(
											getAccountBalanceCents(account)
										)}
									</p>
								</div>
								<p class="text-right text-sm text-zinc-600">
									{account.profile ? account.profile.label : m.no_profile()}
								</p>
							</div>
						</article>
					{/each}
				{/if}
			</div>
			<div class="mt-5 border-t border-zinc-200 pt-4">
				<p class="text-sm leading-6 text-zinc-700">{m.privacy_note()}</p>
			</div>
		</section>
	</aside>
</main>
