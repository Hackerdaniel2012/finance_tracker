<script lang="ts">
	import * as m from '$lib/paraglide/messages';
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
	let transactionCategoryId = $state('');
	let transactionNote = $state('');
	let transactionTags = $state('');
	let transactionCreateRule = $state(true);
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

	const openReviewCount = $derived(unknownTransactions.length);

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
				fetchJson<TransactionListResult>('/api/transactions/unknown?limit=50')
			]);

			categories = categoryPayload.categories;
			rules = rulePayload.rules;
			unknownTransactions = unknownPayload.transactions;
			ruleCategoryId = ruleCategoryId || categories[0]?.id || '';
			transactionCategoryId = transactionCategoryId || categories[0]?.id || '';
			status = m.review_status_ready();
		} catch {
			status = m.review_status_error();
			error = m.review_status_error();
		}
	}

	function selectTransaction(transaction: Transaction) {
		selectedTransaction = transaction;
		transactionCategoryId = transaction.categoryId ?? categories[0]?.id ?? '';
		transactionNote = transaction.note ?? '';
		transactionTags = transaction.tags.map((tag) => tag.name).join(', ');
		transactionCreateRule = true;
		transactionRuleName = transaction.payee ? `${m.rule_for()} ${transaction.payee}` : '';
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

	async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
		if (!response.ok) {
			throw new Error(await response.text());
		}

		return (await response.json()) as T;
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
				<h2 class="text-lg font-semibold text-zinc-950">{m.unknown_review_queue()}</h2>
				<p class="mt-1 text-sm text-zinc-500">
					{openReviewCount}
					{m.open_items()}
				</p>
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
				<button
					class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700"
					type="button"
					onclick={startNewRule}
				>
					{m.new_rule()}
				</button>
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
