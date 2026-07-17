<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { BarChart, LineChart } from 'layerchart/svg';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ErrorAlert from '$lib/components/ErrorAlert.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import type { PageData } from './$types';

	interface RecentTransaction {
		id: string;
		accountName: string;
		categoryName: string | null;
		bookingDate: string;
		amountCents: number;
		payee: string | null;
		classificationStatus: string;
	}

	interface CategorySummary {
		categoryId: string | null;
		categoryName: string;
		type: string;
		expenseCents: number;
		incomeCents: number;
		netCents: number;
		transactionCount: number;
	}

	let { data } = $props<{ data: PageData }>();

	let recentTransactions = $state<RecentTransaction[]>([]);
	let recentError = $state<string | null>(null);
	let isRecentTransactionsLoading = $state(true);
	let categoryView = $state<'expense' | 'income'>('expense');

	const balanceCents = $derived(data.summary.byAccount[0]?.balanceCents ?? null);
	const historyPoints = $derived(
		data.history.points.map((point: { date: string; balanceCents: number }) => ({
			date: new Date(`${point.date}T00:00:00.000Z`),
			balance: point.balanceCents / 100
		}))
	);
	const categoryPoints = $derived(
		data.summary.byCategory
			.filter(
				(category: CategorySummary) =>
					(categoryView === 'expense' ? category.expenseCents : category.incomeCents) > 0
			)
			.slice(0, 8)
			.map((category: CategorySummary) => {
				const amount =
					(categoryView === 'expense' ? category.expenseCents : category.incomeCents) / 100;
				return {
					category: category.categoryName,
					knownAmount: category.categoryId ? amount : 0,
					unknownAmount: category.categoryId ? 0 : amount
				};
			})
	);

	$effect(() => {
		void loadRecentTransactions(data.account.id);
	});

	async function loadRecentTransactions(accountId: string) {
		isRecentTransactionsLoading = true;
		recentError = null;

		try {
			const payload = await fetchJsonWithRetry<{ transactions: RecentTransaction[] }>(
				`/api/transactions?accountId=${encodeURIComponent(accountId)}&limit=10&sort=booking_date&direction=desc`
			);
			recentTransactions = payload.transactions;
		} catch {
			recentError = m.recent_transactions_load_error();
		} finally {
			isRecentTransactionsLoading = false;
		}
	}

	function switchAccount(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		void goto(resolve(`/accounts/${select.value}`));
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
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
	<title>{data.account.name} | {m.account_summary_title()} | {m.app_title()}</title>
</svelte:head>

<main class="mx-auto grid max-w-[90rem] gap-6 px-6 pb-[50px] pt-6 lg:pt-8">
	<section class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<label class="grid gap-1 text-sm font-medium text-zinc-700">
			<span>{m.select_account()}</span>
			<select
				class="w-full rounded border-zinc-300 sm:w-64"
				value={data.account.id}
				onchange={switchAccount}
			>
				{#each data.accounts as account (account.id)}
					<option value={account.id}>{account.name}</option>
				{/each}
			</select>
		</label>
	</section>

	<section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
		<article class="rounded-ui border border-zinc-200 bg-white p-4">
			<p class="text-sm font-medium text-zinc-500">{m.account_balance()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">
				{balanceCents === null ? m.balance_not_initialized() : centsToEuros(balanceCents)}
			</p>
		</article>
		<article class="rounded-ui border border-zinc-200 bg-white p-4">
			<p class="text-sm font-medium text-zinc-500">{m.account_income()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">
				{centsToEuros(data.summary.totals.incomeCents)}
			</p>
		</article>
		<article class="rounded-ui border border-zinc-200 bg-white p-4">
			<p class="text-sm font-medium text-zinc-500">{m.account_expenses()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">
				{centsToEuros(data.summary.totals.expenseCents)}
			</p>
		</article>
		<article class="rounded-ui border border-zinc-200 bg-white p-4">
			<p class="text-sm font-medium text-zinc-500">{m.account_net()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">
				{centsToEuros(data.summary.totals.netCents)}
			</p>
		</article>
		<article class="rounded-ui border border-zinc-200 bg-white p-4">
			<p class="text-sm font-medium text-zinc-500">{m.unknown_transactions()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">{data.summary.totals.unknownCount}</p>
		</article>
	</section>

	<section class="rounded-ui border border-zinc-200 bg-white p-5">
		<div class="flex items-center justify-between gap-4">
			<h2 class="text-lg font-semibold text-zinc-950">{m.account_balance_history()}</h2>
			<p class="text-sm text-zinc-500">{data.history.range.from} – {data.history.range.to}</p>
		</div>
		<div class="mt-5 h-72 p-4">
			{#if historyPoints.length > 0}
				<LineChart
					data={historyPoints}
					x="date"
					y="balance"
					height={240}
					axis
					grid
					props={{ xAxis: { tickSpacing: 100 } }}
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

	<section class="grid gap-6 xl:grid-cols-2">
		<article
			class="rounded-ui border border-zinc-200 bg-white p-5"
			aria-busy={isRecentTransactionsLoading}
		>
			<h2 class="text-lg font-semibold text-zinc-950">{m.recent_transactions()}</h2>
			{#if recentError}
				<ErrorAlert
					class="mt-4"
					message={recentError}
					retry={() => loadRecentTransactions(data.account.id)}
					retryLabel={m.retry()}
				/>
			{:else}
				<div class="mt-4 divide-y divide-zinc-200">
					{#if isRecentTransactionsLoading}
						{#each Array(4) as _}
							<div class="grid grid-cols-[1fr_auto] gap-3 py-3">
								<div class="space-y-2">
									<Skeleton class="h-5 w-40" /><Skeleton class="h-4 w-24" />
								</div>
								<Skeleton class="h-5 w-20" />
							</div>
						{/each}
					{:else if recentTransactions.length === 0}
						<p class="py-4 text-sm text-zinc-500">{m.no_recent_transactions()}</p>
					{:else}
						{#each recentTransactions as transaction (transaction.id)}
							<div class="grid grid-cols-[1fr_auto] gap-3 py-3">
								<div>
									<p class="font-medium text-zinc-950">
										{transaction.payee || transaction.categoryName || m.uncategorized()}
									</p>
									<p class="mt-1 text-sm text-zinc-500">{formatDate(transaction.bookingDate)}</p>
								</div>
								<p class="font-medium text-zinc-950">{centsToEuros(transaction.amountCents)}</p>
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</article>

		<article class="rounded-ui border border-zinc-200 bg-white p-5">
			<div class="flex items-center justify-between gap-3">
				<h2 class="text-lg font-semibold text-zinc-950">{m.category()}</h2>
				<div class="flex rounded border border-zinc-300 p-1 text-xs font-medium">
					<button
						class:bg-zinc-950={categoryView === 'expense'}
						class:text-white={categoryView === 'expense'}
						class="rounded px-2 py-1"
						type="button"
						onclick={() => (categoryView = 'expense')}>{m.expenses()}</button
					>
					<button
						class:bg-zinc-950={categoryView === 'income'}
						class:text-white={categoryView === 'income'}
						class="rounded px-2 py-1"
						type="button"
						onclick={() => (categoryView = 'income')}>{m.income()}</button
					>
				</div>
			</div>
			{#if categoryPoints.length > 0}
				<div class="mt-4 h-64 p-4">
					<BarChart
						data={categoryPoints}
						x="knownAmount"
						y="category"
						orientation="horizontal"
						axis
						grid
						seriesLayout="stack"
						series={[
							{ key: 'known', value: 'knownAmount', color: '#047857' },
							{ key: 'unknown', value: 'unknownAmount', color: '#d97706' }
						]}
						class="h-full w-full"
					/>
				</div>
			{/if}
			<div class="mt-4 divide-y divide-zinc-200">
				{#if data.summary.byCategory.length === 0}
					<p class="py-4 text-sm text-zinc-500">{m.no_recent_transactions()}</p>
				{:else}
					{#each data.summary.byCategory.filter((category: CategorySummary) => (categoryView === 'expense' ? category.expenseCents : category.incomeCents) > 0) as category (category.categoryId ?? 'unknown')}
						<div class="flex items-center justify-between gap-3 py-3">
							<div>
								<p class="font-medium text-zinc-950">{category.categoryName}</p>
								<p class="text-xs text-zinc-500">
									{category.transactionCount}
									{m.account_transaction_count()}
								</p>
							</div>
							<p class="font-medium text-zinc-950">
								{centsToEuros(
									categoryView === 'expense' ? category.expenseCents : category.incomeCents
								)}
							</p>
						</div>
					{/each}
				{/if}
			</div>
		</article>
	</section>
</main>
