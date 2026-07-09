<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { LineChart } from 'layerchart/svg';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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

	let { data } = $props<{ data: PageData }>();

	let recentTransactions = $state<RecentTransaction[]>([]);
	let recentError = $state<string | null>(null);

	const balanceCents = $derived(
		data.account.currentBalanceCents ?? data.account.openingBalanceCents
	);
	const historyPoints = $derived(
		data.history.points.map((point: { date: string; balanceCents: number }) => ({
			date: point.date,
			balance: point.balanceCents / 100
		}))
	);

	$effect(() => {
		void loadRecentTransactions(data.account.id);
	});

	async function loadRecentTransactions(accountId: string) {
		recentError = null;

		try {
			const response = await fetch(
				`/api/transactions?accountId=${encodeURIComponent(accountId)}&limit=10&sort=booking_date&direction=desc`
			);
			if (!response.ok) {
				throw new Error(await response.text());
			}

			const payload = (await response.json()) as { transactions: RecentTransaction[] };
			recentTransactions = payload.transactions;
		} catch {
			recentError = m.transactions_status_error();
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

<main class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:py-8">
	<section class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-3xl font-semibold text-zinc-950">{m.account_summary_title()}</h1>
			<p class="mt-1 text-zinc-600">
				{data.account.institution || m.institution()} · {data.summary.range.from} – {data.summary
					.range.to}
			</p>
		</div>
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
		<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
			<p class="text-sm font-medium text-zinc-500">{m.account_balance()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">{centsToEuros(balanceCents)}</p>
		</article>
		<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
			<p class="text-sm font-medium text-zinc-500">{m.account_income()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">
				{centsToEuros(data.summary.totals.incomeCents)}
			</p>
		</article>
		<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
			<p class="text-sm font-medium text-zinc-500">{m.account_expenses()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">
				{centsToEuros(data.summary.totals.expenseCents)}
			</p>
		</article>
		<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
			<p class="text-sm font-medium text-zinc-500">{m.account_net()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">
				{centsToEuros(data.summary.totals.netCents)}
			</p>
		</article>
		<article class="rounded border border-zinc-200 bg-white p-4 shadow-sm">
			<p class="text-sm font-medium text-zinc-500">{m.unknown_transactions()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">{data.summary.totals.unknownCount}</p>
		</article>
	</section>

	<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
		<div class="flex items-center justify-between gap-4">
			<h2 class="text-lg font-semibold text-zinc-950">{m.account_balance_history()}</h2>
			<p class="text-sm text-zinc-500">{data.history.range.from} – {data.history.range.to}</p>
		</div>
		<div class="mt-5 h-64">
			{#if historyPoints.length > 0}
				<LineChart
					data={historyPoints}
					x="date"
					y="balance"
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
			{#if recentError}
				<p class="mt-4 text-sm text-red-700">{recentError}</p>
			{:else}
				<div class="mt-4 divide-y divide-zinc-200">
					{#if recentTransactions.length === 0}
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

		<article class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.category()}</h2>
			<div class="mt-4 divide-y divide-zinc-200">
				{#if data.summary.byCategory.length === 0}
					<p class="py-4 text-sm text-zinc-500">{m.no_recent_transactions()}</p>
				{:else}
					{#each data.summary.byCategory as category (category.categoryId ?? 'unknown')}
						<div class="flex items-center justify-between gap-3 py-3">
							<div>
								<p class="font-medium text-zinc-950">{category.categoryName}</p>
								<p class="text-xs text-zinc-500">
									{category.transactionCount}
									{m.account_transaction_count()}
								</p>
							</div>
							<p class="font-medium text-zinc-950">{centsToEuros(category.amountCents)}</p>
						</div>
					{/each}
				{/if}
			</div>
		</article>
	</section>
</main>
