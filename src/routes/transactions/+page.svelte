<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { buildAccountScopeOptions, parseAccountScope } from '$lib/account-scope';
	import { onMount } from 'svelte';

	type TransactionClassificationStatus = 'unknown' | 'auto' | 'manual' | 'ignored';
	type TransactionDirection = 'income' | 'expense';
	type TransactionSort = 'booking_date' | 'amount_cents' | 'payee';
	type SortDirection = 'asc' | 'desc';
	type CategoryType = 'income' | 'expense' | 'transfer' | 'investment' | 'unknown';

	interface Account {
		id: string;
		name: string;
		institution: string | null;
		subaccounts: string[];
	}

	interface Category {
		id: string;
		name: string;
		type: CategoryType;
	}

	interface Transaction {
		id: string;
		accountId: string;
		accountName: string;
		kind: 'standard' | 'combined_import';
		subaccount: string | null;
		combineBeforeDate: string | null;
		categoryId: string | null;
		categoryName: string | null;
		bookingDate: string;
		valueDate: string | null;
		amountCents: number;
		currency: string;
		payee: string | null;
		description: string | null;
		note: string | null;
		classificationStatus: TransactionClassificationStatus;
		tags: Array<{ id: string; name: string; color: string | null }>;
		reviewFlag: { id: string; reason: string; status: string } | null;
	}

	function transactionPayee(transaction: Transaction): string {
		if (transaction.kind === 'combined_import' && transaction.combineBeforeDate) {
			return m.combined_balance_before({ date: formatDate(transaction.combineBeforeDate) });
		}
		return transaction.payee ?? m.not_available();
	}

	function transactionDescription(transaction: Transaction): string {
		if (transaction.kind === 'combined_import') {
			return transaction.subaccount ?? m.default_subaccount();
		}
		return transaction.description ?? m.not_available();
	}

	function transactionAccount(transaction: Transaction): string {
		return transaction.subaccount
			? `${transaction.accountName} / ${transaction.subaccount}`
			: transaction.accountName;
	}

	interface TransactionListResult {
		transactions: Transaction[];
		pagination: {
			total: number;
			limit: number;
			offset: number;
		};
	}

	const statusOptions: TransactionClassificationStatus[] = ['unknown', 'auto', 'manual', 'ignored'];
	const transactionDirectionOptions: TransactionDirection[] = ['expense', 'income'];
	const sortOptions: TransactionSort[] = ['booking_date', 'amount_cents', 'payee'];
	const pageSize = 25;

	let accounts = $state<Account[]>([]);
	let categories = $state<Category[]>([]);
	let transactions = $state<Transaction[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let search = $state('');
	let from = $state('');
	let to = $state('');
	let accountScope = $state('');
	let statusFilter = $state('');
	let categoryFilter = $state('');
	let transactionDirectionFilter = $state('');
	let minAmount = $state('');
	let maxAmount = $state('');
	let tagFilter = $state('');
	let sort = $state<TransactionSort>('booking_date');
	let direction = $state<SortDirection>('desc');
	let selected = $state<Transaction | null>(null);
	let editCategoryId = $state('');
	let editNote = $state('');
	let editTags = $state('');
	let createRule = $state(false);
	let ruleName = $state('');
	let pageStatus = $state(m.transactions_status_loading());
	let error = $state<string | null>(null);
	let isLoading = $state(false);
	let isSaving = $state(false);

	const pageStart = $derived(total === 0 ? 0 : offset + 1);
	const pageEnd = $derived(Math.min(offset + pageSize, total));
	const canGoBack = $derived(offset > 0);
	const canGoForward = $derived(offset + pageSize < total);

	onMount(() => {
		void loadPage();
	});

	async function loadPage() {
		isLoading = true;
		pageStatus = m.transactions_status_loading();
		error = null;

		try {
			const [accountPayload, categoryPayload, transactionPayload] = await Promise.all([
				fetchJson<{ accounts: Account[] }>('/api/accounts'),
				fetchJson<{ categories: Category[] }>('/api/categories'),
				fetchJson<TransactionListResult>(`/api/transactions?${buildQueryString()}`)
			]);

			accounts = accountPayload.accounts;
			categories = categoryPayload.categories;
			applyTransactionResult(transactionPayload);
			pageStatus = m.transactions_status_ready();
		} catch {
			pageStatus = m.transactions_status_error();
			error = m.transactions_status_error();
		} finally {
			isLoading = false;
		}
	}

	async function loadTransactions() {
		isLoading = true;
		error = null;

		try {
			const payload = await fetchJson<TransactionListResult>(
				`/api/transactions?${buildQueryString()}`
			);
			applyTransactionResult(payload);
			pageStatus = m.transactions_status_ready();
		} catch {
			pageStatus = m.transactions_status_error();
			error = m.transactions_status_error();
		} finally {
			isLoading = false;
		}
	}

	function applyTransactionResult(payload: TransactionListResult) {
		transactions = payload.transactions;
		total = payload.pagination.total;
		offset = payload.pagination.offset;

		if (selected) {
			const refreshed = transactions.find((transaction) => transaction.id === selected?.id) ?? null;
			selected = refreshed;
			if (refreshed) setEditTransaction(refreshed);
		}
	}

	function applyFilters(event: SubmitEvent) {
		event.preventDefault();
		offset = 0;
		void loadTransactions();
	}

	function changePage(nextOffset: number) {
		offset = Math.max(0, nextOffset);
		void loadTransactions();
	}

	function selectTransaction(transaction: Transaction) {
		selected = transaction;
		setEditTransaction(transaction);
	}

	function setEditTransaction(transaction: Transaction) {
		editCategoryId = transaction.categoryId ?? '';
		editNote = transaction.note ?? '';
		editTags = transaction.tags.map((tag) => tag.name).join(', ');
		createRule = false;
		ruleName = '';
	}

	async function saveTransaction(event: SubmitEvent) {
		event.preventDefault();
		if (!selected) return;

		isSaving = true;
		error = null;

		try {
			const payload = await fetchJson<{ transaction: Transaction }>(
				`/api/transactions/${selected.id}`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						categoryId: editCategoryId || null,
						note: editNote.trim() || null,
						tagNames: parseTags(editTags),
						createRule,
						...(createRule && ruleName.trim() ? { ruleName: ruleName.trim() } : {})
					})
				}
			);

			selected = payload.transaction;
			setEditTransaction(payload.transaction);
			pageStatus = m.transactions_status_saved();
			await loadTransactions();
		} catch {
			pageStatus = m.transactions_status_error();
			error = m.transactions_status_error();
		} finally {
			isSaving = false;
		}
	}

	function buildQueryString(): string {
		const params: Array<[string, string]> = [
			['limit', String(pageSize)],
			['offset', String(offset)],
			['sort', sort],
			['direction', direction]
		];

		if (search.trim()) params.push(['search', search.trim()]);
		if (from) params.push(['from', from]);
		if (to) params.push(['to', to]);
		if (accountScope) {
			const { accountId, subaccount } = parseAccountScope(accountScope);
			params.push(['accountId', accountId]);
			if (subaccount) params.push(['subaccount', subaccount]);
		}
		if (statusFilter) params.push(['status', statusFilter]);
		if (categoryFilter) params.push(['categoryId', categoryFilter]);
		if (transactionDirectionFilter)
			params.push(['transactionDirection', transactionDirectionFilter]);
		const minAmountCents = eurosToOptionalCents(minAmount);
		const maxAmountCents = eurosToOptionalCents(maxAmount);
		if (minAmountCents !== null) params.push(['minAmountCents', String(minAmountCents)]);
		if (maxAmountCents !== null) params.push(['maxAmountCents', String(maxAmountCents)]);
		if (tagFilter.trim()) params.push(['tag', tagFilter.trim()]);

		return params
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
			.join('&');
	}

	async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		return fetchJsonWithRetry<T>(url, init);
	}

	function parseTags(value: string): string[] {
		return value
			.split(',')
			.map((tag) => tag.trim())
			.filter((tag) => tag.length > 0);
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
	}

	function eurosToOptionalCents(value: string): number | null {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number.parseFloat(trimmed.replace(',', '.'));
		return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
	}

	function formatDate(value: string | null): string {
		if (!value) return m.not_available();
		return new Date(`${value}T00:00:00`).toLocaleDateString();
	}

	function statusLabel(value: TransactionClassificationStatus): string {
		return {
			unknown: m.status_unknown(),
			auto: m.status_auto(),
			manual: m.status_manual(),
			ignored: m.status_ignored()
		}[value];
	}

	function transactionDirectionLabel(value: TransactionDirection): string {
		return {
			income: m.account_income(),
			expense: m.account_expenses()
		}[value];
	}

	function sortLabel(value: TransactionSort): string {
		return {
			booking_date: m.date(),
			amount_cents: m.amount(),
			payee: m.payee()
		}[value];
	}
</script>

<svelte:head>
	<title>{m.transactions_title()} / {m.app_title()}</title>
	<meta name="description" content={m.transactions_subtitle()} />
</svelte:head>

<main class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[20rem_1fr] lg:py-8">
	<section class="space-y-2 lg:col-span-2">
		<h1 class="text-3xl font-semibold tracking-normal text-zinc-950">{m.transactions_title()}</h1>
		<p class="max-w-3xl text-sm leading-6 text-zinc-600">{m.transactions_subtitle()}</p>
		<p class="text-sm text-zinc-500">{pageStatus}</p>
	</section>

	<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
		<h2 class="text-lg font-semibold text-zinc-950">{m.filters()}</h2>
		<form class="mt-5 grid gap-4" onsubmit={applyFilters}>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.search_transactions()}</span>
				<input class="w-full rounded border-zinc-300" type="search" bind:value={search} />
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.from_date()}</span>
					<input class="w-full rounded border-zinc-300" type="date" bind:value={from} />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.to_date()}</span>
					<input class="w-full rounded border-zinc-300" type="date" bind:value={to} />
				</label>
			</div>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.status()}</span>
				<select class="w-full rounded border-zinc-300" bind:value={statusFilter}>
					<option value="">{m.all_statuses()}</option>
					{#each statusOptions as option (option)}
						<option value={option}>{statusLabel(option)}</option>
					{/each}
				</select>
			</label>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.account()}</span>
				<select
					aria-label={m.account()}
					class="w-full rounded border-zinc-300"
					bind:value={accountScope}
				>
					<option value="">{m.all_accounts()}</option>
					{#each buildAccountScopeOptions(accounts) as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.category()}</span>
				<select class="w-full rounded border-zinc-300" bind:value={categoryFilter}>
					<option value="">{m.all_categories()}</option>
					{#each categories as category (category.id)}
						<option value={category.id}>{category.name}</option>
					{/each}
				</select>
			</label>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.transaction_direction()}</span>
				<select
					aria-label={m.transaction_direction()}
					class="w-full rounded border-zinc-300"
					bind:value={transactionDirectionFilter}
				>
					<option value="">{m.all_directions()}</option>
					{#each transactionDirectionOptions as option (option)}
						<option value={option}>{transactionDirectionLabel(option)}</option>
					{/each}
				</select>
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.min_amount()}</span>
					<input
						aria-label={m.min_amount()}
						class="w-full rounded border-zinc-300"
						inputmode="decimal"
						bind:value={minAmount}
					/>
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.max_amount()}</span>
					<input
						aria-label={m.max_amount()}
						class="w-full rounded border-zinc-300"
						inputmode="decimal"
						bind:value={maxAmount}
					/>
				</label>
			</div>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.tag_filter()}</span>
				<input
					aria-label={m.tag_filter()}
					class="w-full rounded border-zinc-300"
					bind:value={tagFilter}
				/>
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.sort_by()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={sort}>
						{#each sortOptions as option (option)}
							<option value={option}>{sortLabel(option)}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.direction()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={direction}>
						<option value="desc">{m.descending()}</option>
						<option value="asc">{m.ascending()}</option>
					</select>
				</label>
			</div>
			<button
				class="h-11 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
				type="submit"
				disabled={isLoading}
			>
				{m.apply_filters()}
			</button>
		</form>

		{#if error}
			<p class="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
				{error}
			</p>
		{/if}
	</section>

	<section class="min-w-0 grid gap-6">
		<section class="min-w-0 overflow-hidden rounded-ui border border-zinc-200 bg-white shadow-sm">
			<div class="flex flex-col gap-3 border-b border-zinc-200 p-5 sm:flex-row sm:justify-between">
				<div>
					<h2 class="text-lg font-semibold text-zinc-950">{m.transaction_table()}</h2>
					<p class="mt-1 text-sm text-zinc-500">
						{pageStart}-{pageEnd} / {total}
					</p>
				</div>
				<div class="flex gap-2">
					<button
						class="h-11 rounded border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-40"
						type="button"
						disabled={!canGoBack || isLoading}
						onclick={() => changePage(offset - pageSize)}
					>
						{m.previous_page()}
					</button>
					<button
						class="h-11 rounded border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-40"
						type="button"
						disabled={!canGoForward || isLoading}
						onclick={() => changePage(offset + pageSize)}
					>
						{m.next_page()}
					</button>
				</div>
			</div>

			{#if transactions.length === 0}
				<p class="p-5 text-sm text-zinc-600">{m.no_transactions()}</p>
			{:else}
				<div class="max-w-full overflow-x-auto">
					<table class="min-w-full divide-y divide-zinc-200 text-sm">
						<thead class="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
							<tr>
								<th class="px-4 py-3">{m.date()}</th>
								<th class="px-4 py-3">{m.payee()}</th>
								<th class="px-4 py-3">{m.account()}</th>
								<th class="px-4 py-3">{m.category()}</th>
								<th class="px-4 py-3">{m.status()}</th>
								<th class="px-4 py-3 text-right">{m.amount()}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-zinc-100 bg-white">
							{#each transactions as transaction (transaction.id)}
								<tr
									class="cursor-pointer hover:bg-zinc-50"
									class:bg-amber-50={selected?.id === transaction.id}
									onclick={() => selectTransaction(transaction)}
								>
									<td class="whitespace-nowrap px-4 py-3 text-zinc-700">
										{formatDate(transaction.bookingDate)}
									</td>
									<td class="min-w-64 px-4 py-3">
										<p class="font-medium text-zinc-950">
											{transactionPayee(transaction)}
										</p>
										<p class="mt-1 line-clamp-2 text-xs text-zinc-500">
											{transactionDescription(transaction)}
										</p>
									</td>
									<td class="whitespace-nowrap px-4 py-3 text-zinc-700">
										{transactionAccount(transaction)}
									</td>
									<td class="whitespace-nowrap px-4 py-3 text-zinc-700">
										{transaction.categoryName ?? m.uncategorized()}
									</td>
									<td class="whitespace-nowrap px-4 py-3">
										<span class="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700">
											{statusLabel(transaction.classificationStatus)}
										</span>
									</td>
									<td
										class="whitespace-nowrap px-4 py-3 text-right font-medium"
										class:text-emerald-700={transaction.amountCents > 0}
										class:text-zinc-950={transaction.amountCents <= 0}
									>
										{centsToEuros(transaction.amountCents)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.edit_transaction()}</h2>
			{#if selected}
				<div class="mt-4 rounded border border-zinc-200 bg-zinc-50 p-4 text-sm">
					<p class="font-medium text-zinc-950">{transactionPayee(selected)}</p>
					<p class="mt-1 text-zinc-600">
						{formatDate(selected.bookingDate)} / {centsToEuros(selected.amountCents)}
					</p>
				</div>
				{#if selected.kind === 'combined_import'}
					<p class="mt-4 text-sm text-zinc-600">{m.combined_transaction_read_only()}</p>
				{:else}<form class="mt-5 grid gap-4" onsubmit={saveTransaction}>
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.category()}</span>
							<select class="w-full rounded border-zinc-300" bind:value={editCategoryId}>
								<option value="">{m.uncategorized()}</option>
								{#each categories as category (category.id)}
									<option value={category.id}>{category.name}</option>
								{/each}
							</select>
						</label>
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.notes()}</span>
							<textarea class="w-full rounded border-zinc-300" rows="3" bind:value={editNote}
							></textarea>
						</label>
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.tags()}</span>
							<input class="w-full rounded border-zinc-300" bind:value={editTags} />
							<span class="text-xs font-normal text-zinc-500">{m.tag_help()}</span>
						</label>
						<label class="flex items-center gap-2 text-sm font-medium text-zinc-700">
							<input class="rounded border-zinc-300" type="checkbox" bind:checked={createRule} />
							<span>{m.create_rule_from_edit()}</span>
						</label>
						{#if createRule}
							<label class="grid gap-1 text-sm font-medium text-zinc-700">
								<span>{m.rule_name()}</span>
								<input class="w-full rounded border-zinc-300" bind:value={ruleName} />
							</label>
						{/if}
						<button
							class="h-11 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
							type="submit"
							disabled={isSaving}
						>
							{m.save_transaction()}
						</button>
					</form>{/if}
			{:else}
				<p class="mt-4 text-sm leading-6 text-zinc-600">{m.select_transaction()}</p>
			{/if}
		</section>
	</section>
</main>
