<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { onMount } from 'svelte';

	type CategoryType = 'income' | 'expense' | 'transfer' | 'investment' | 'unknown';
	type RuleField = 'payee' | 'description' | 'note' | 'search_text';
	type RuleOperator = 'contains' | 'equals' | 'starts_with' | 'regex';

	interface Category {
		id: string;
		name: string;
		type: CategoryType;
		color: string | null;
		icon: string | null;
		isDefault: boolean;
		sortOrder: number;
	}

	interface CategoryRule {
		id: string;
		categoryId: string;
		name: string;
		field: RuleField;
		operator: RuleOperator;
		pattern: string;
		priority: number;
		isGlobal: boolean;
	}

	interface Transaction {
		id: string;
		accountName: string;
		categoryId: string | null;
		categoryName: string | null;
		bookingDate: string;
		amountCents: number;
		payee: string | null;
		description: string | null;
		note: string | null;
		tags: Array<{ id: string; name: string; color: string | null }>;
		reviewFlag: { id: string; reason: string; status: string } | null;
	}

	interface TransactionListResult {
		transactions: Transaction[];
		pagination: {
			total: number;
			limit: number;
			offset: number;
		};
	}

	const categoryTypes: CategoryType[] = ['expense', 'income', 'transfer', 'investment', 'unknown'];
	const ruleFields: RuleField[] = ['payee', 'description', 'note', 'search_text'];
	const ruleOperators: RuleOperator[] = ['contains', 'equals', 'starts_with', 'regex'];

	let categories = $state<Category[]>([]);
	let rules = $state<CategoryRule[]>([]);
	let unknownTransactions = $state<Transaction[]>([]);
	let selectedTransaction = $state<Transaction | null>(null);
	let selectedCategory = $state<Category | null>(null);
	let selectedRule = $state<CategoryRule | null>(null);
	let unknownSearch = $state('');
	let unknownOffset = $state(0);
	let unknownPagination = $state({ total: 0, limit: 10, offset: 0 });
	let transactionCategoryId = $state('');
	let transactionNote = $state('');
	let transactionTags = $state('');
	let transactionCreateRule = $state(false);
	let transactionApplyRuleToExisting = $state(false);
	let transactionRulePreview = $state<{
		matchCount: number;
		sample: Array<{ id: string; payee: string | null; amountCents: number }>;
	} | null>(null);
	let transactionRuleName = $state('');
	let categoryName = $state('');
	let categoryType = $state<CategoryType>('expense');
	let categoryColor = $state('');
	let categoryIcon = $state('');
	let categorySortOrder = $state('100');
	let ruleCategoryId = $state('');
	let ruleName = $state('');
	let ruleField = $state<RuleField>('payee');
	let ruleOperator = $state<RuleOperator>('contains');
	let rulePattern = $state('');
	let rulePriority = $state('100');
	let ruleIsGlobal = $state(true);
	let status = $state(m.review_status_loading());
	let error = $state<string | null>(null);
	let isSavingTransaction = $state(false);
	let isSavingCategory = $state(false);
	let isSavingRule = $state(false);
	let isReapplyingRules = $state(false);

	const openReviewCount = $derived(unknownPagination.total);
	const canGoToPreviousUnknownPage = $derived(unknownPagination.offset > 0);
	const canGoToNextUnknownPage = $derived(
		unknownPagination.offset + unknownPagination.limit < unknownPagination.total
	);
	const unknownPageStart = $derived(
		unknownPagination.total === 0 ? 0 : unknownPagination.offset + 1
	);
	const unknownPageEnd = $derived(
		Math.min(unknownPagination.offset + unknownPagination.limit, unknownPagination.total)
	);

	onMount(() => {
		void loadReviewState();
	});

	async function loadReviewState() {
		status = m.review_status_loading();
		error = null;

		try {
			const [categoryPayload, rulePayload, unknownPayload] = await Promise.all([
				fetchJson<{ categories: Category[] }>('/api/categories'),
				fetchJson<{ rules: CategoryRule[] }>('/api/category-rules'),
				fetchJson<TransactionListResult>(`/api/transactions/unknown${buildUnknownQueueQuery()}`)
			]);

			categories = categoryPayload.categories;
			rules = rulePayload.rules;
			unknownTransactions = unknownPayload.transactions;
			unknownPagination = unknownPayload.pagination;
			ruleCategoryId = ruleCategoryId || categories[0]?.id || '';
			status = m.review_status_ready();
		} catch {
			status = m.review_status_error();
			error = m.review_status_error();
		}
	}

	async function searchUnknownTransactions(event: SubmitEvent) {
		event.preventDefault();
		unknownOffset = 0;
		selectedTransaction = null;
		await loadReviewState();
	}

	async function goToPreviousUnknownPage() {
		unknownOffset = Math.max(0, unknownOffset - unknownPagination.limit);
		selectedTransaction = null;
		await loadReviewState();
	}

	async function goToNextUnknownPage() {
		unknownOffset = unknownOffset + unknownPagination.limit;
		selectedTransaction = null;
		await loadReviewState();
	}

	function selectTransaction(transaction: Transaction) {
		selectedTransaction = transaction;
		transactionCategoryId = transaction.categoryId ?? '';
		transactionNote = transaction.note ?? '';
		transactionTags = transaction.tags.map((tag) => tag.name).join(', ');
		transactionCreateRule = false;
		transactionApplyRuleToExisting = false;
		transactionRulePreview = null;
		transactionRuleName = transaction.payee ? `${m.rule_for()} ${transaction.payee}` : '';
	}

	async function previewTransactionRule() {
		if (!selectedTransaction?.payee || !transactionCategoryId) return;
		transactionRulePreview = await fetchJson('/api/category-rules/preview', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				categoryId: transactionCategoryId,
				name: transactionRuleName || `Rule for ${selectedTransaction.payee}`,
				field: 'payee',
				operator: 'contains',
				pattern: selectedTransaction.payee,
				priority: 100,
				isGlobal: true
			})
		});
	}

	async function classifyTransaction(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedTransaction || !transactionCategoryId) return;

		isSavingTransaction = true;
		error = null;

		try {
			await fetchJson<{ transaction: Transaction }>(`/api/transactions/${selectedTransaction.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					categoryId: transactionCategoryId,
					note: transactionNote.trim() || null,
					tagNames: parseTags(transactionTags),
					createRule: transactionCreateRule,
					applyRuleToExisting: transactionCreateRule && transactionApplyRuleToExisting,
					...(transactionCreateRule && transactionRuleName.trim()
						? { ruleName: transactionRuleName.trim() }
						: {})
				})
			});

			selectedTransaction = null;
			status = m.review_status_saved();
			await loadReviewState();
		} catch {
			status = m.review_status_error();
			error = m.review_status_error();
		} finally {
			isSavingTransaction = false;
		}
	}

	function startNewCategory() {
		selectedCategory = null;
		categoryName = '';
		categoryType = 'expense';
		categoryColor = '';
		categoryIcon = '';
		categorySortOrder = '100';
	}

	function selectCategory(category: Category) {
		selectedCategory = category;
		categoryName = category.name;
		categoryType = category.type;
		categoryColor = category.color ?? '';
		categoryIcon = category.icon ?? '';
		categorySortOrder = String(category.sortOrder);
	}

	async function saveCategory(event: SubmitEvent) {
		event.preventDefault();
		isSavingCategory = true;
		error = null;

		try {
			if (selectedCategory) {
				await fetchJson<{ category: Category }>('/api/categories', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						id: selectedCategory.id,
						name: categoryName,
						type: categoryType,
						color: categoryColor.trim() || null,
						icon: categoryIcon.trim() || null,
						sortOrder: parseInteger(categorySortOrder)
					})
				});
			} else {
				await fetchJson<{ category: Category }>('/api/categories', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						name: categoryName,
						type: categoryType,
						color: categoryColor.trim() || null,
						icon: categoryIcon.trim() || null,
						sortOrder: parseInteger(categorySortOrder)
					})
				});
			}

			startNewCategory();
			status = m.review_status_saved();
			await loadReviewState();
		} catch {
			status = m.review_status_error();
			error = m.review_status_error();
		} finally {
			isSavingCategory = false;
		}
	}

	function startNewRule() {
		selectedRule = null;
		ruleCategoryId = categories[0]?.id ?? '';
		ruleName = '';
		ruleField = 'payee';
		ruleOperator = 'contains';
		rulePattern = '';
		rulePriority = '100';
		ruleIsGlobal = true;
	}

	function selectRule(rule: CategoryRule) {
		selectedRule = rule;
		ruleCategoryId = rule.categoryId;
		ruleName = rule.name;
		ruleField = rule.field;
		ruleOperator = rule.operator;
		rulePattern = rule.pattern;
		rulePriority = String(rule.priority);
		ruleIsGlobal = rule.isGlobal;
	}

	async function saveRule(event: SubmitEvent) {
		event.preventDefault();
		isSavingRule = true;
		error = null;

		const body = {
			categoryId: ruleCategoryId,
			name: ruleName,
			field: ruleField,
			operator: ruleOperator,
			pattern: rulePattern,
			priority: parseInteger(rulePriority),
			isGlobal: ruleIsGlobal
		};

		try {
			if (selectedRule) {
				await fetchJson<{ rule: CategoryRule }>('/api/category-rules', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ id: selectedRule.id, ...body })
				});
			} else {
				await fetchJson<{ rule: CategoryRule }>('/api/category-rules', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				});
			}

			startNewRule();
			status = m.review_status_saved();
			await loadReviewState();
		} catch {
			status = m.review_status_error();
			error = m.review_status_error();
		} finally {
			isSavingRule = false;
		}
	}

	async function reapplyRules() {
		isReapplyingRules = true;
		error = null;

		try {
			const { result } = await fetchJson<{ result: { matchedCount: number; unmatchedCount: number } }>(
				'/api/category-rules/apply',
				{
					method: 'POST'
				}
			);
			status = m.rules_applied({ matched: String(result.matchedCount), unmatched: String(result.unmatchedCount) });
			await loadReviewState();
		} catch {
			status = m.review_status_error();
			error = m.review_status_error();
		} finally {
			isReapplyingRules = false;
		}
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

	function parseInteger(value: string): number {
		const parsed = Number(value);
		return Number.isInteger(parsed) ? parsed : 100;
	}

	function buildUnknownQueueQuery(): string {
		const params = [
			['limit', String(unknownPagination.limit)],
			['offset', String(unknownOffset)]
		];
		if (unknownSearch.trim()) params.push(['search', unknownSearch.trim()]);

		return `?${params
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
			.join('&')}`;
	}

	function categoryNameFor(id: string): string {
		return categories.find((category) => category.id === id)?.name ?? m.uncategorized();
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
	}

	function formatDate(value: string): string {
		return new Date(`${value}T00:00:00`).toLocaleDateString();
	}

	function typeLabel(value: CategoryType): string {
		return {
			expense: m.category_type_expense(),
			income: m.category_type_income(),
			transfer: m.category_type_transfer(),
			investment: m.category_type_investment(),
			unknown: m.category_type_unknown()
		}[value];
	}

	function fieldLabel(value: RuleField): string {
		return {
			payee: m.payee(),
			description: m.description(),
			note: m.notes(),
			search_text: m.search_text()
		}[value];
	}

	function operatorLabel(value: RuleOperator): string {
		return {
			contains: m.operator_contains(),
			equals: m.operator_equals(),
			starts_with: m.operator_starts_with(),
			regex: m.operator_regex()
		}[value];
	}
</script>

<svelte:head>
	<title>{m.review_title()} / {m.app_title()}</title>
	<meta name="description" content={m.review_subtitle()} />
</svelte:head>

<main class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:py-8">
	<section class="space-y-2">
		<h1 class="text-3xl font-semibold tracking-normal text-zinc-950">{m.review_title()}</h1>
		<p class="max-w-3xl text-sm leading-6 text-zinc-600">{m.review_subtitle()}</p>
		<p class="text-sm text-zinc-500">{status}</p>
	</section>

	{#if error}
		<p class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
	{/if}

	<section class="grid gap-6 xl:grid-cols-[1fr_24rem]">
		<section class="rounded border border-zinc-200 bg-white shadow-sm">
			<div class="border-b border-zinc-200 p-5">
				<div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
					<div>
						<h2 class="text-lg font-semibold text-zinc-950">{m.unknown_review_queue()}</h2>
						<p class="mt-1 text-sm text-zinc-500">
							{openReviewCount}
							{m.all_time_open()}
						</p>
					</div>
					<form
						class="flex flex-col gap-2 sm:flex-row sm:items-end"
						onsubmit={searchUnknownTransactions}
					>
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.search_transactions()}</span>
							<input
								class="w-full rounded border-zinc-300 sm:w-64"
								aria-label={m.search_transactions()}
								bind:value={unknownSearch}
							/>
						</label>
						<button
							class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
							type="submit"
						>
							{m.apply_filters()}
						</button>
					</form>
				</div>
			</div>

			{#if unknownTransactions.length === 0}
				<p class="p-5 text-sm text-zinc-600">{m.no_unknown_transactions()}</p>
			{:else}
				<div class="divide-y divide-zinc-100">
					{#each unknownTransactions as transaction (transaction.id)}
						<button
							class="grid w-full gap-2 px-5 py-4 text-left hover:bg-zinc-50 sm:grid-cols-[8rem_1fr_9rem]"
							class:bg-amber-50={selectedTransaction?.id === transaction.id}
							type="button"
							onclick={() => selectTransaction(transaction)}
						>
							<span class="text-sm text-zinc-600">{formatDate(transaction.bookingDate)}</span>
							<span>
								<span class="block font-medium text-zinc-950">
									{transaction.payee ?? m.not_available()}
								</span>
								<span class="mt-1 line-clamp-2 block text-xs text-zinc-500">
									{transaction.description ?? transaction.reviewFlag?.reason ?? m.not_available()}
								</span>
							</span>
							<span class="text-right text-sm font-medium text-zinc-950">
								{centsToEuros(transaction.amountCents)}
							</span>
						</button>
					{/each}
				</div>
			{/if}
			<div
				class="flex flex-col gap-3 border-t border-zinc-200 p-5 sm:flex-row sm:items-center sm:justify-between"
			>
				<p class="text-sm text-zinc-500">
					{unknownPageStart}-{unknownPageEnd} / {unknownPagination.total}
				</p>
				<div class="flex gap-2">
					<button
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
						type="button"
						disabled={!canGoToPreviousUnknownPage}
						onclick={goToPreviousUnknownPage}
					>
						{m.previous_page()}
					</button>
					<button
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
						type="button"
						disabled={!canGoToNextUnknownPage}
						onclick={goToNextUnknownPage}
					>
						{m.next_page()}
					</button>
				</div>
			</div>
		</section>

		<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.classify_transaction()}</h2>
			{#if selectedTransaction}
				<div class="mt-4 rounded border border-zinc-200 bg-zinc-50 p-4 text-sm">
					<p class="font-medium text-zinc-950">
						{selectedTransaction.payee ?? m.not_available()}
					</p>
					<p class="mt-1 text-zinc-600">
						{selectedTransaction.accountName} / {centsToEuros(selectedTransaction.amountCents)}
					</p>
				</div>
				<form class="mt-5 grid gap-4" onsubmit={classifyTransaction}>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.category()}</span>
						<select
							class="w-full rounded border-zinc-300"
							bind:value={transactionCategoryId}
							required
						>
							<option value="" disabled>{m.select_category()}</option>
							{#each categories as category (category.id)}
								<option value={category.id}>{category.name}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.notes()}</span>
						<textarea class="w-full rounded border-zinc-300" rows="3" bind:value={transactionNote}
						></textarea>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.tags()}</span>
						<input class="w-full rounded border-zinc-300" bind:value={transactionTags} />
						<span class="text-xs font-normal text-zinc-500">{m.tag_help()}</span>
					</label>
					<label class="flex items-center gap-2 text-sm font-medium text-zinc-700">
						<input
							class="rounded border-zinc-300"
							type="checkbox"
							bind:checked={transactionCreateRule}
						/>
						<span>{m.create_rule_from_edit()}</span>
					</label>
					{#if transactionCreateRule}
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.rule_name()}</span>
							<input class="w-full rounded border-zinc-300" bind:value={transactionRuleName} />
						</label>
						<button
							class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700"
							type="button"
							onclick={previewTransactionRule}
						>
							{m.preview_rule_matches()}
						</button>
						{#if transactionRulePreview}
							<div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
								<p>{m.rule_existing_matches({ count: transactionRulePreview.matchCount })}</p>
								<label class="mt-2 flex items-center gap-2 font-medium">
									<input type="checkbox" bind:checked={transactionApplyRuleToExisting} />
									<span>{m.apply_rule_existing()}</span>
								</label>
							</div>
						{/if}
					{/if}
					<button
						class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
						type="submit"
						disabled={isSavingTransaction || !transactionCategoryId}
					>
						{m.save_classification()}
					</button>
				</form>
			{:else}
				<p class="mt-4 text-sm leading-6 text-zinc-600">{m.select_unknown_transaction()}</p>
			{/if}
		</section>
	</section>

	<section class="grid gap-6 xl:grid-cols-2">
		<section class="rounded border border-zinc-200 bg-white shadow-sm">
			<div class="flex items-center justify-between border-b border-zinc-200 p-5">
				<h2 class="text-lg font-semibold text-zinc-950">{m.categories_title()}</h2>
				<button
					class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700"
					type="button"
					onclick={startNewCategory}
				>
					{m.new_category()}
				</button>
			</div>
			<div class="grid gap-5 p-5 lg:grid-cols-[1fr_18rem]">
				<div class="divide-y divide-zinc-100 rounded border border-zinc-200">
					{#each categories as category (category.id)}
						<button
							class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50"
							class:bg-amber-50={selectedCategory?.id === category.id}
							type="button"
							onclick={() => selectCategory(category)}
						>
							<span>
								<span class="block font-medium text-zinc-950">{category.name}</span>
								<span class="text-xs text-zinc-500">{typeLabel(category.type)}</span>
							</span>
							<span class="text-xs text-zinc-500">#{category.sortOrder}</span>
						</button>
					{/each}
				</div>
				<form class="grid content-start gap-4" onsubmit={saveCategory}>
					<h3 class="text-sm font-semibold text-zinc-950">
						{selectedCategory ? m.edit_category() : m.new_category()}
					</h3>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.category_name()}</span>
						<input class="w-full rounded border-zinc-300" bind:value={categoryName} required />
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.category_type()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={categoryType}>
							{#each categoryTypes as type (type)}
								<option value={type}>{typeLabel(type)}</option>
							{/each}
						</select>
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.color()}</span>
							<input class="w-full rounded border-zinc-300" bind:value={categoryColor} />
						</label>
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.icon()}</span>
							<input class="w-full rounded border-zinc-300" bind:value={categoryIcon} />
						</label>
					</div>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.sort_order()}</span>
						<input class="w-full rounded border-zinc-300" bind:value={categorySortOrder} />
					</label>
					<button
						class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
						type="submit"
						disabled={isSavingCategory}
					>
						{m.save_category()}
					</button>
				</form>
			</div>
		</section>

		<section class="rounded border border-zinc-200 bg-white shadow-sm">
			<div class="flex items-center justify-between border-b border-zinc-200 p-5">
				<h2 class="text-lg font-semibold text-zinc-950">{m.category_rules_title()}</h2>
				<div class="flex gap-2">
					<button
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
						type="button"
						disabled={isReapplyingRules}
						onclick={reapplyRules}
					>
						{m.reapply_rules()}
					</button>
					<button
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700"
						type="button"
						onclick={startNewRule}
					>
						{m.new_rule()}
					</button>
				</div>
			</div>
			<div class="grid gap-5 p-5 lg:grid-cols-[1fr_18rem]">
				<div class="divide-y divide-zinc-100 rounded border border-zinc-200">
					{#each rules as rule (rule.id)}
						<button
							class="grid w-full gap-1 px-4 py-3 text-left hover:bg-zinc-50"
							class:bg-amber-50={selectedRule?.id === rule.id}
							type="button"
							onclick={() => selectRule(rule)}
						>
							<span class="font-medium text-zinc-950">{rule.name}</span>
							<span class="text-xs text-zinc-500">
								{categoryNameFor(rule.categoryId)} / {fieldLabel(rule.field)}
								{operatorLabel(rule.operator)} "{rule.pattern}"
							</span>
						</button>
					{:else}
						<p class="p-4 text-sm text-zinc-600">{m.no_category_rules()}</p>
					{/each}
				</div>
				<form class="grid content-start gap-4" onsubmit={saveRule}>
					<h3 class="text-sm font-semibold text-zinc-950">
						{selectedRule ? m.edit_rule() : m.new_rule()}
					</h3>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.rule_name()}</span>
						<input class="w-full rounded border-zinc-300" bind:value={ruleName} required />
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.category()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={ruleCategoryId} required>
							{#each categories as category (category.id)}
								<option value={category.id}>{category.name}</option>
							{/each}
						</select>
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.field()}</span>
							<select class="w-full rounded border-zinc-300" bind:value={ruleField}>
								{#each ruleFields as field (field)}
									<option value={field}>{fieldLabel(field)}</option>
								{/each}
							</select>
						</label>
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.operator()}</span>
							<select class="w-full rounded border-zinc-300" bind:value={ruleOperator}>
								{#each ruleOperators as operator (operator)}
									<option value={operator}>{operatorLabel(operator)}</option>
								{/each}
							</select>
						</label>
					</div>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.pattern()}</span>
						<input class="w-full rounded border-zinc-300" bind:value={rulePattern} required />
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.priority()}</span>
						<input class="w-full rounded border-zinc-300" bind:value={rulePriority} />
					</label>
					<label class="flex items-center gap-2 text-sm font-medium text-zinc-700">
						<input class="rounded border-zinc-300" type="checkbox" bind:checked={ruleIsGlobal} />
						<span>{m.global_rule()}</span>
					</label>
					<button
						class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
						type="submit"
						disabled={isSavingRule || !ruleCategoryId}
					>
						{m.save_rule()}
					</button>
				</form>
			</div>
		</section>
	</section>
</main>
