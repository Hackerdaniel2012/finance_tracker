<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { summarizePlans } from '$lib/planning-summary';
	import ButtonSpinner from '$lib/components/ButtonSpinner.svelte';
	import ErrorAlert from '$lib/components/ErrorAlert.svelte';
	import InlineSuccess from '$lib/components/InlineSuccess.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Picker from '$lib/components/Picker.svelte';
	import DatePicker from '$lib/components/DatePicker.svelte';
	import { onMount } from 'svelte';
	type Direction = 'expense' | 'income';
	type Cadence = 'once' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
	type Status = 'active' | 'paused' | 'done' | 'cancelled';
	interface Account {
		id: string;
		name: string;
	}
	interface Category {
		id: string;
		name: string;
		type: string;
	}
	interface Plan {
		id: string;
		accountId: string | null;
		accountName: string | null;
		categoryId: string | null;
		categoryName: string | null;
		label: string | null;
		counterparty: string | null;
		direction: Direction;
		cadence: Cadence;
		amountCents: number;
		nextDate: string;
		endDate: string | null;
		status: Status;
		note: string | null;
		transactionCount: number;
		lastTransactionDate: string | null;
		transactions: Array<{
			transactionId: string;
			bookingDate: string;
			amountCents: number;
			payee: string | null;
			description: string | null;
			categoryName: string | null;
			matchKind: 'evidence' | 'automatic';
			scheduledDate: string | null;
			interestCents: number | null;
			principalCents: number | null;
		}>;
		scheduleAnchorDate: string;
		scheduleOccurrenceIndex: number;
		liabilityId: string | null;
	}
	interface RecurringGroup {
		id: string;
		accountId: string | null;
		accountName: string | null;
		categoryId: string | null;
		categoryName: string | null;
		label: string | null;
		payee: string;
		direction: 'incoming' | 'outgoing' | null;
		cadence: Exclude<Cadence, 'once'>;
		expectedAmountCents: number;
		nextDate: string | null;
		endDate: string | null;
		status: 'suggested' | 'confirmed' | 'ignored';
		confidence: number;
		confidenceFactors: { interval: number; amount: number; history: number; recency: number };
		evidence: Array<{
			transactionId: string;
			bookingDate: string;
			amountCents: number;
			payee: string | null;
			description: string | null;
		}>;
	}
	interface Liability {
		id: string;
		accountName: string | null;
		name: string;
		amountCents: number;
		asOfDate: string;
		annualInterestRateBps: number | null;
		status: 'active' | 'cleared';
		note: string | null;
		plan: {
			id: string;
			label: string | null;
			counterparty: string | null;
			categoryName: string | null;
			cadence: Cadence;
			amountCents: number;
			nextDate: string;
			endDate: string | null;
			status: Status;
		} | null;
		projection: {
			nextInterestCents: number;
			nextPrincipalCents: number;
			estimatedRemainingPayments: number | null;
			estimatedPayoffDate: string | null;
			estimatedRemainingInterestCents: number | null;
		} | null;
	}
	let accounts = $state<Account[]>([]),
		categories = $state<Category[]>([]),
		plans = $state<Plan[]>([]),
		suggestions = $state<RecurringGroup[]>([]),
		liabilities = $state<Liability[]>([]),
		error = $state(''),
		editingId = $state<string | null>(null);
	let isInitialLoading = $state(true);
	let loadError = $state('');
	let planSuccess = $state('');
	let suggestionSuccess = $state('');
	let liabilityError = $state('');
	let liabilitySuccess = $state('');
	let isCreatingPlan = $state(false);
	let savingPlanId = $state<string | null>(null);
	let changingPlanId = $state<string | null>(null);
	let deletingPlanId = $state<string | null>(null);
	let deletingLiabilityId = $state<string | null>(null);
	let confirmingSuggestionId = $state<string | null>(null);
	let ignoringSuggestionId = $state<string | null>(null);
	let form = $state(blankPlan());
	let editForm = $state(blankPlan());
	let editError = $state('');
	let selectedSuggestionId = $state<string | null>(null);
	let suggestionError = $state('');
	let suggestionForms = $state<
		Record<
			string,
			{
				categoryId: string;
				label: string;
				cadence: Exclude<Cadence, 'once'>;
				amount: string;
				nextDate: string;
				endDate: string;
				indefinite: boolean;
				direction: Direction;
				createLiability: boolean;
				liabilityName: string;
				liabilityAmount: string;
				liabilityAsOfDate: string;
				liabilityInterestRate: string;
			}
		>
	>({});
	const cadenceOptions = $derived([
		{ value: 'once', label: m.plan_once() },
		{ value: 'daily', label: m.plan_daily() },
		{ value: 'weekly', label: m.plan_weekly() },
		{ value: 'biweekly', label: m.plan_biweekly() },
		{ value: 'monthly', label: m.plan_monthly() },
		{ value: 'quarterly', label: m.plan_quarterly() },
		{ value: 'yearly', label: m.plan_yearly() }
	]);
	const directionOptions = $derived([
		{ value: 'expense', label: m.expenses() },
		{ value: 'income', label: m.income() }
	]);
	const categoryOptions = $derived([
		{ value: '', label: m.no_category() },
		...categories.map((c) => ({ value: c.id, label: c.name }))
	]);
	const accountOptions = $derived([
		{ value: '', label: m.all_accounts() },
		...accounts.map((a) => ({ value: a.id, label: a.name }))
	]);
	const expenseSummary = $derived(summarizePlans(plans, 'expense', today()));
	const incomeSummary = $derived(summarizePlans(plans, 'income', today()));
	const editingPlan = $derived(plans.find((plan) => plan.id === editingId) ?? null);
	function blankPlan() {
		return {
			counterparty: '',
			label: '',
			direction: 'expense' as Direction,
			cadence: 'once' as Cadence,
			amount: '',
			nextDate: today(),
			endDate: '',
			indefinite: true,
			accountId: '',
			categoryId: '',
			status: 'active' as Status,
			note: '',
			createLiability: false,
			liabilityName: '',
			liabilityAmount: '',
			liabilityAsOfDate: today(),
			liabilityInterestRate: ''
		};
	}
	function today() {
		return new Date().toISOString().slice(0, 10);
	}
	function euros(c: number) {
		return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100);
	}
	function cents(value: string) {
		return Math.round(Number(value.replace(',', '.')) * 100);
	}
	function rateBps(value: string) {
		return Math.round(Number(value.replace(',', '.')) * 100);
	}
	function cadenceLabel(value: Cadence): string {
		return {
			once: m.plan_once,
			daily: m.plan_daily,
			weekly: m.plan_weekly,
			biweekly: m.plan_biweekly,
			monthly: m.plan_monthly,
			quarterly: m.plan_quarterly,
			yearly: m.plan_yearly
		}[value]();
	}
	function statusLabel(value: Status): string {
		return {
			active: m.status_active,
			paused: m.status_paused,
			done: m.status_done,
			cancelled: m.status_cancelled
		}[value]();
	}
	function liabilityStatusLabel(value: Liability['status']): string {
		return value === 'active' ? m.status_active() : m.status_cleared();
	}
	function matchKindLabel(value: Plan['transactions'][number]['matchKind']): string {
		return value === 'automatic' ? m.automatically_matched() : m.supporting_evidence();
	}
	function formatDate(value: string | null): string {
		return value
			? new Intl.DateTimeFormat('en-US', {
					year: 'numeric',
					month: 'numeric',
					day: 'numeric',
					timeZone: 'UTC'
				}).format(new Date(`${value}T00:00:00Z`))
			: '—';
	}
	function isSettledThisMonth(plan: Plan): boolean {
		if (!plan.lastTransactionDate || plan.lastTransactionDate.slice(0, 7) !== today().slice(0, 7))
			return false;
		if (plan.status === 'done') return true;
		const now = new Date(`${today()}T00:00:00Z`);
		const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
			.toISOString()
			.slice(0, 10);
		return plan.nextDate > monthEnd;
	}
	async function load(showLoading = true) {
		if (showLoading) isInitialLoading = true;
		loadError = '';
		const results = await Promise.allSettled([
			fetchJsonWithRetry<{ accounts: Account[] }>('/api/accounts'),
			fetchJsonWithRetry<{ categories: Category[] }>('/api/categories'),
			fetchJsonWithRetry<{ plans: Plan[] }>('/api/plans'),
			fetchJsonWithRetry<{ recurringGroups: RecurringGroup[] }>('/api/recurring', {
				cache: 'no-store'
			}),
			fetchJsonWithRetry<{ liabilities: Liability[] }>('/api/liabilities')
		]);
		if (results[0].status === 'fulfilled') accounts = results[0].value.accounts;
		if (results[1].status === 'fulfilled') categories = results[1].value.categories;
		if (results[2].status === 'fulfilled') plans = results[2].value.plans;
		if (results[3].status === 'fulfilled') {
			suggestions = results[3].value.recurringGroups.filter(
				(group) => group.status === 'suggested'
			);
			suggestionForms = Object.fromEntries(
				suggestions.map((group) => [
					group.id,
					{
						categoryId: group.categoryId ?? '',
						label: group.label ?? '',
						cadence: group.cadence,
						amount: String(group.expectedAmountCents / 100),
						nextDate: group.nextDate ?? today(),
						endDate: group.endDate ?? '',
						indefinite: !group.endDate,
						direction:
							group.direction === 'incoming' ? ('income' as Direction) : ('expense' as Direction),
						createLiability: false,
						liabilityName: group.label || group.payee,
						liabilityAmount: '',
						liabilityAsOfDate: today(),
						liabilityInterestRate: ''
					}
				])
			);
		}
		if (results[4].status === 'fulfilled') liabilities = results[4].value.liabilities;
		const failure = results.find((result) => result.status === 'rejected');
		if (failure?.status === 'rejected') {
			loadError = m.planning_load_error();
		}
		if (showLoading) isInitialLoading = false;
	}
	onMount(() => {
		void load();
	});
	function visible(direction: Direction) {
		return plans.filter((plan) => plan.direction === direction);
	}
	function edit(plan: Plan) {
		editingId = plan.id;
		editError = '';
		editForm = {
			...blankPlan(),
			counterparty: plan.counterparty ?? '',
			label: plan.label ?? '',
			direction: plan.direction,
			cadence: plan.cadence,
			amount: (plan.amountCents / 100).toFixed(2),
			nextDate: plan.nextDate,
			endDate: plan.endDate ?? '',
			indefinite: !plan.endDate,
			accountId: plan.accountId ?? '',
			categoryId: plan.categoryId ?? '',
			status: plan.status,
			note: plan.note ?? ''
		};
	}
	function resetEdit() {
		editingId = null;
		editError = '';
		editForm = blankPlan();
	}
	function planPayload(value: ReturnType<typeof blankPlan>) {
		return {
			counterparty: value.counterparty || null,
			label: value.label || null,
			direction: value.direction,
			cadence: value.cadence,
			amountCents: cents(value.amount),
			nextDate: value.nextDate,
			endDate: value.cadence === 'once' || value.indefinite ? null : value.endDate || null,
			accountId: value.accountId || null,
			categoryId: value.categoryId || null,
			status: value.status,
			note: value.note || null
		};
	}
	function changedPlanPayload(plan: Plan, value: ReturnType<typeof blankPlan>) {
		const payload = planPayload(value);
		const current = {
			counterparty: plan.counterparty,
			label: plan.label,
			direction: plan.direction,
			cadence: plan.cadence,
			amountCents: plan.amountCents,
			nextDate: plan.nextDate,
			endDate: plan.endDate,
			accountId: plan.accountId,
			categoryId: plan.categoryId,
			status: plan.status,
			note: plan.note
		};
		return Object.fromEntries(
			Object.entries(payload).filter(
				([key, value]) => value !== current[key as keyof typeof current]
			)
		);
	}
	function togglePlanLiability() {
		form.createLiability = !form.createLiability;
		if (form.createLiability) {
			form.direction = 'expense';
			form.cadence = form.cadence === 'once' ? 'monthly' : form.cadence;
			form.categoryId = 'cat-installment-plan';
			form.indefinite = true;
			form.liabilityName ||= form.label || form.counterparty;
		}
		error = '';
	}
	async function createPlan() {
		error = '';
		planSuccess = '';
		const liabilityAmountCents = cents(form.liabilityAmount);
		const liabilityInterestRateBps = rateBps(form.liabilityInterestRate);
		if (
			form.createLiability &&
			(!form.liabilityName.trim() ||
				!Number.isFinite(liabilityAmountCents) ||
				liabilityAmountCents <= 0 ||
				!Number.isFinite(liabilityInterestRateBps) ||
				liabilityInterestRateBps < 0)
		) {
			error = m.liability_details_required();
			return;
		}
		isCreatingPlan = true;
		try {
			const response = await fetch('/api/plans', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...planPayload(form),
					liability: form.createLiability
						? {
								name: form.liabilityName.trim(),
								amountCents: liabilityAmountCents,
								asOfDate: form.liabilityAsOfDate,
								annualInterestRateBps: liabilityInterestRateBps
							}
						: undefined
				})
			});
			if (!response.ok) throw new Error(await response.text());
			form = blankPlan();
			await load(false);
			planSuccess = m.plan_created_success();
		} catch {
			error = m.plan_create_error();
		} finally {
			isCreatingPlan = false;
		}
	}
	async function saveEdit() {
		if (!editingId) return;
		editError = '';
		planSuccess = '';
		savingPlanId = editingId;
		try {
			const plan = editingPlan;
			if (!plan) return;
			const changes = changedPlanPayload(plan, editForm);
			if (Object.keys(changes).length === 0) return resetEdit();
			const response = await fetch('/api/plans', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: editingId, ...changes })
			});
			if (!response.ok) throw new Error(await response.text());
			resetEdit();
			await load(false);
			planSuccess = m.plan_saved_success();
		} catch {
			editError = m.plan_save_error();
		} finally {
			savingPlanId = null;
		}
	}
	async function changeStatus(plan: Plan, status: Status) {
		changingPlanId = plan.id;
		error = '';
		try {
			const response = await fetch('/api/plans', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: plan.id, status })
			});
			if (!response.ok) throw new Error();
			await load(false);
			planSuccess = m.plan_saved_success();
		} catch {
			error = m.plan_save_error();
		} finally {
			changingPlanId = null;
		}
	}
	async function remove(id: string) {
		deletingPlanId = id;
		error = '';
		try {
			const response = await fetch('/api/plans', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!response.ok) throw new Error();
			await load(false);
			planSuccess = m.plan_deleted_success();
		} catch {
			error = m.plan_delete_error();
		} finally {
			deletingPlanId = null;
		}
	}
	async function removeLiability(id: string) {
		if (!window.confirm(m.delete_liability_confirm())) return;
		deletingLiabilityId = id;
		liabilityError = '';
		liabilitySuccess = '';
		try {
			const response = await fetch('/api/liabilities', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!response.ok) throw new Error();
			await load(false);
			liabilitySuccess = m.liability_deleted_success();
		} catch {
			liabilityError = m.liability_delete_error();
		} finally {
			deletingLiabilityId = null;
		}
	}
	function suggestionForm(group: RecurringGroup) {
		return suggestionForms[group.id];
	}
	function reviewSuggestion(id: string) {
		selectedSuggestionId = id;
		suggestionError = '';
	}
	function cancelSuggestion() {
		selectedSuggestionId = null;
		suggestionError = '';
	}
	function toggleSuggestionLiability(group: RecurringGroup) {
		const value = suggestionForm(group);
		value.createLiability = !value.createLiability;
		if (value.createLiability) {
			value.direction = 'expense';
			value.categoryId = 'cat-installment-plan';
			value.liabilityName ||= group.label || group.payee;
		}
		suggestionError = '';
	}
	async function responseError(response: Response): Promise<string> {
		try {
			const payload = (await response.json()) as { error?: string };
			return payload.error || m.recurring_confirm_error();
		} catch {
			return m.recurring_confirm_error();
		}
	}
	async function confirm(group: RecurringGroup) {
		const value = suggestionForm(group);
		suggestionError = '';
		if (!value.categoryId) {
			suggestionError = m.recurring_category_required();
			return;
		}
		if (!value.indefinite && !value.endDate) {
			suggestionError = m.recurring_end_date_required();
			return;
		}
		if (
			value.createLiability &&
			(!value.liabilityName.trim() ||
				cents(value.liabilityAmount) <= 0 ||
				!Number.isFinite(rateBps(value.liabilityInterestRate)) ||
				rateBps(value.liabilityInterestRate) < 0)
		) {
			suggestionError = m.liability_details_required();
			return;
		}
		confirmingSuggestionId = group.id;
		suggestionSuccess = '';
		try {
			const response = await fetch(`/api/recurring/${group.id}/confirm`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					categoryId: value.categoryId,
					label: value.label || null,
					cadence: value.cadence,
					expectedAmountCents: cents(value.amount),
					nextDate: value.nextDate,
					endDate: value.indefinite ? null : value.endDate,
					direction: value.direction === 'income' ? 'incoming' : 'outgoing',
					liability: value.createLiability
						? {
								name: value.liabilityName.trim(),
								amountCents: cents(value.liabilityAmount),
								asOfDate: value.liabilityAsOfDate,
								annualInterestRateBps: rateBps(value.liabilityInterestRate)
							}
						: null
				})
			});
			if (!response.ok) {
				suggestionError = await responseError(response);
				return;
			}
			cancelSuggestion();
			await load(false);
			suggestionSuccess = m.recurring_confirmed_success();
		} catch {
			suggestionError = m.recurring_confirm_error();
		} finally {
			confirmingSuggestionId = null;
		}
	}
	async function ignore(id: string) {
		ignoringSuggestionId = id;
		suggestionError = '';
		try {
			const response = await fetch(`/api/recurring/${id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status: 'ignored' })
			});
			if (!response.ok) throw new Error();
			await load(false);
			suggestionSuccess = m.recurring_ignored_success();
		} catch {
			suggestionError = m.recurring_ignore_error();
		} finally {
			ignoringSuggestionId = null;
		}
	}
</script>

<svelte:head><title>{m.planning_title()}</title></svelte:head>
<section class="mx-auto max-w-[90rem] space-y-8 px-6 pb-[50px] pt-8">
	{#if loadError}<ErrorAlert message={loadError} retry={load} retryLabel={m.retry()} />{/if}
	{#if error}<ErrorAlert message={error} />{/if}
	{#if planSuccess}
		<InlineSuccess message={planSuccess} onDismiss={() => (planSuccess = '')} />
	{/if}
	{#snippet manualPlanForm()}
		<div class="rounded-ui border border-zinc-200 bg-white p-5">
			<h2 class="text-lg font-semibold text-zinc-950">{m.create_plan()}</h2>
			<div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<label>{m.counterparty()}<input bind:value={form.counterparty} class="field" /></label
				><label>{m.label()}<input bind:value={form.label} class="field" /></label><label
					>{m.direction()}<Picker
						bind:value={form.direction}
						options={directionOptions}
						placeholder={m.direction()}
						ariaLabel={m.direction()}
						disabled={form.createLiability}
					/></label
				><label
					>{m.cadence()}<Picker
						bind:value={form.cadence}
						options={cadenceOptions}
						placeholder={m.cadence()}
						ariaLabel={m.cadence()}
						disabled={form.createLiability}
					/></label
				><label
					>{m.amount()}<input bind:value={form.amount} inputmode="decimal" class="field" /></label
				><label
					>{m.next_date()}<DatePicker
						bind:value={form.nextDate}
						ariaLabel={m.next_date()}
						todayLabel={m.today()}
						clearLabel={m.clear()}
						previousMonthLabel={m.previous_month()}
						nextMonthLabel={m.next_month()}
						allowClear={false}
					/></label
				><label
					>{m.account()}<Picker
						bind:value={form.accountId}
						options={accountOptions}
						placeholder={m.all_accounts()}
						ariaLabel={m.account()}
					/></label
				><label
					>{m.category()}<Picker
						bind:value={form.categoryId}
						options={categoryOptions}
						placeholder={m.no_category()}
						ariaLabel={m.category()}
						disabled={form.createLiability}
					/></label
				>{#if form.cadence !== 'once'}<label
						>{m.end_date()}<DatePicker
							bind:value={form.endDate}
							disabled={form.indefinite}
							ariaLabel={m.end_date()}
							todayLabel={m.today()}
							clearLabel={m.clear()}
							previousMonthLabel={m.previous_month()}
							nextMonthLabel={m.next_month()}
						/></label
					><label class="flex items-end gap-2 pb-2"
						><button
							type="button"
							class:active={form.indefinite}
							class="switch"
							aria-label={m.indefinite()}
							aria-pressed={form.indefinite}
							onclick={() => (form.indefinite = !form.indefinite)}><span></span></button
						>{m.indefinite()}</label
					>{/if}<label>{m.note()}<input bind:value={form.note} class="field" /></label>
			</div>
			<label class="mt-5 flex items-center gap-2"
				><button
					type="button"
					class:active={form.createLiability}
					class="switch"
					aria-label={m.create_liability_from_suggestion()}
					aria-pressed={form.createLiability}
					onclick={togglePlanLiability}><span></span></button
				>{m.create_liability_from_suggestion()}</label
			>
			{#if form.createLiability}
				<div
					class="mt-4 grid gap-3 rounded-ui border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2 lg:grid-cols-4"
				>
					<label>{m.liability_name()}<input class="field" bind:value={form.liabilityName} /></label>
					<label
						>{m.remaining_balance()}<input
							class="field"
							inputmode="decimal"
							bind:value={form.liabilityAmount}
						/></label
					>
					<label
						>{m.annual_interest_rate()}<input
							class="field"
							inputmode="decimal"
							placeholder={m.interest_rate_placeholder()}
							bind:value={form.liabilityInterestRate}
						/></label
					>
					<label
						>{m.as_of_date()}<DatePicker
							bind:value={form.liabilityAsOfDate}
							ariaLabel={m.as_of_date()}
							todayLabel={m.today()}
							clearLabel={m.clear()}
							previousMonthLabel={m.previous_month()}
							nextMonthLabel={m.next_month()}
							allowClear={false}
						/></label
					>
				</div>
			{/if}
			<div class="mt-5 flex gap-3">
				<button
					class="button-primary"
					type="button"
					disabled={isCreatingPlan}
					aria-busy={isCreatingPlan}
					onclick={createPlan}
				>
					{#if isCreatingPlan}<ButtonSpinner />{/if}{m.create_plan()}
				</button>
			</div>
		</div>
	{/snippet}
	{#each [{ direction: 'expense' as Direction, title: m.expenses() }, { direction: 'income' as Direction, title: m.income() }] as section (section.direction)}
		<section
			class="overflow-visible rounded-ui border border-zinc-200 bg-white"
			aria-busy={isInitialLoading}
		>
			<div
				class="flex flex-col gap-4 border-b border-zinc-200 p-5 lg:flex-row lg:items-center lg:justify-between"
			>
				<h2 class="text-lg font-semibold text-zinc-950">{section.title}</h2>
				{#if section.direction === 'expense'}
					<div class="grid gap-x-8 gap-y-3 sm:grid-cols-3">
						<div>
							<p class="text-xs text-zinc-500">{m.expenses_remaining_this_month()}</p>
							<p class="mt-1 text-sm font-medium text-zinc-950">
								{euros(expenseSummary.remainingThisMonthCents)}
							</p>
						</div>
						<div>
							<p class="text-xs text-zinc-500">{m.active_contracts()}</p>
							<p class="mt-1 text-sm font-medium text-zinc-950">
								{expenseSummary.activeRecurringCount}
							</p>
						</div>
						<div>
							<p class="text-xs text-zinc-500">{m.monthly_contract_cost()}</p>
							<p class="mt-1 text-sm font-medium text-zinc-950">
								{euros(expenseSummary.monthlyRecurringCents)}
							</p>
						</div>
					</div>
				{:else}
					<div class="grid gap-x-8 gap-y-3 sm:grid-cols-2">
						<div>
							<p class="text-xs text-zinc-500">{m.active_contracts()}</p>
							<p class="mt-1 text-sm font-medium text-zinc-950">
								{incomeSummary.activeRecurringCount}
							</p>
						</div>
						<div>
							<p class="text-xs text-zinc-500">{m.monthly_contract_cost()}</p>
							<p class="mt-1 text-sm font-medium text-zinc-950">
								{euros(incomeSummary.monthlyRecurringCents)}
							</p>
						</div>
					</div>
				{/if}
			</div>
			<div>
				{#if isInitialLoading}
					{#each Array(3) as _}
						<div
							class="grid grid-cols-[7rem_1fr_auto] items-center gap-4 border-b border-zinc-100 p-4"
						>
							<Skeleton class="h-5 w-full" />
							<div class="space-y-2">
								<Skeleton class="h-5 w-44" /><Skeleton class="h-4 w-56" />
							</div>
							<Skeleton class="h-11 w-28" rounded="rounded-ui" />
						</div>
					{/each}
				{:else}
					{#each visible(section.direction) as plan (plan.id)}
						{@const settled = section.direction === 'expense' && isSettledThisMonth(plan)}
						<article class="border-b border-zinc-100 last:border-0">
							<div class="flex flex-wrap items-center gap-3 p-4">
								<span
									class:text-emerald-600={settled}
									class:text-rose-500={section.direction === 'expense' && !settled}
									class:line-through={settled}
									class="flex min-w-24 items-center gap-2 text-sm font-medium"
									aria-label={section.direction === 'expense'
										? `${euros(plan.amountCents)} — ${settled ? m.paid_this_month() : m.still_due_this_month()}`
										: euros(plan.amountCents)}
									>{#if section.direction === 'expense'}{#if settled}<svg
												viewBox="0 0 24 24"
												fill="currentColor"
												class="size-[18px] shrink-0 rounded-full bg-white text-emerald-600"
												aria-hidden="true"
												><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path
													d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z"
												/></svg
											>{:else}<svg
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												class="size-[18px] shrink-0 text-rose-500"
												aria-hidden="true"
												><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path
													d="M8.56 3.69a9 9 0 0 0 -2.92 1.95"
												/><path d="M3.69 8.56a9 9 0 0 0 -.69 3.44" /><path
													d="M3.69 15.44a9 9 0 0 0 1.95 2.92"
												/><path d="M8.56 20.31a9 9 0 0 0 3.44 .69" /><path
													d="M15.44 20.31a9 9 0 0 0 2.92 -1.95"
												/><path d="M20.31 15.44a9 9 0 0 0 .69 -3.44" /><path
													d="M20.31 8.56a9 9 0 0 0 -1.95 -2.92"
												/><path d="M15.44 3.69a9 9 0 0 0 -3.44 -.69" /></svg
											>{/if}{/if}{euros(plan.amountCents)}</span
								>
								<div class="min-w-44 flex-1">
									<p
										class="font-medium"
										class:line-through={settled}
										class:text-zinc-500={settled}
										class:text-zinc-950={!settled}
									>
										{plan.label || plan.counterparty || m.untitled_plan()}
									</p>
									<p
										class="text-sm"
										class:line-through={settled}
										class:text-zinc-400={settled}
										class:text-zinc-600={!settled}
									>
										{plan.nextDate} · {cadenceLabel(plan.cadence)} · {statusLabel(plan.status)}
									</p>
								</div>
								<button class="button-secondary" onclick={() => edit(plan)}>{m.edit()}</button>
								{#if plan.status === 'active'}<button
										class="button-secondary"
										disabled={changingPlanId === plan.id}
										aria-busy={changingPlanId === plan.id}
										onclick={() => changeStatus(plan, 'paused')}
										>{#if changingPlanId === plan.id}<ButtonSpinner />{/if}{m.pause()}</button
									>{:else if plan.status === 'paused'}<button
										class="button-secondary"
										disabled={changingPlanId === plan.id}
										aria-busy={changingPlanId === plan.id}
										onclick={() => changeStatus(plan, 'active')}
										>{#if changingPlanId === plan.id}<ButtonSpinner />{/if}{m.resume()}</button
									>{/if}
								{#if !plan.liabilityId}<button
										class="button-secondary"
										disabled={deletingPlanId === plan.id}
										aria-busy={deletingPlanId === plan.id}
										onclick={() => remove(plan.id)}
										>{#if deletingPlanId === plan.id}<ButtonSpinner />{/if}{m.delete()}</button
									>{/if}
							</div>
							{#if editingId === plan.id}
								<div class="grid gap-4 bg-amber-50 p-5 last:rounded-b-ui">
									<h3 class="font-semibold">{m.edit_plan()}</h3>
									<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
										<label
											>{m.counterparty()}<input
												bind:value={editForm.counterparty}
												class="field"
											/></label
										>
										<label>{m.label()}<input bind:value={editForm.label} class="field" /></label>
										<label
											>{m.direction()}<Picker
												bind:value={editForm.direction}
												options={directionOptions}
												placeholder={m.direction()}
												ariaLabel={m.direction()}
												disabled={Boolean(editingPlan?.liabilityId)}
											/></label
										>
										<label
											>{m.cadence()}<Picker
												bind:value={editForm.cadence}
												options={editingPlan?.liabilityId
													? cadenceOptions.filter((option) => option.value !== 'once')
													: cadenceOptions}
												placeholder={m.cadence()}
												ariaLabel={m.cadence()}
											/></label
										>
										<label
											>{m.amount()}<input
												bind:value={editForm.amount}
												inputmode="decimal"
												class="field"
											/></label
										>
										<label
											>{m.next_date()}<DatePicker
												bind:value={editForm.nextDate}
												ariaLabel={m.next_date()}
												todayLabel={m.today()}
												clearLabel={m.clear()}
												previousMonthLabel={m.previous_month()}
												nextMonthLabel={m.next_month()}
												allowClear={false}
											/></label
										>
										<label
											>{m.account()}<Picker
												bind:value={editForm.accountId}
												options={accountOptions}
												placeholder={m.all_accounts()}
												ariaLabel={m.account()}
											/></label
										>
										<label
											>{m.category()}<Picker
												bind:value={editForm.categoryId}
												options={categoryOptions}
												placeholder={m.no_category()}
												ariaLabel={m.category()}
												disabled={Boolean(editingPlan?.liabilityId)}
											/></label
										>
										{#if editForm.cadence !== 'once'}<label
												>{m.end_date()}<DatePicker
													bind:value={editForm.endDate}
													disabled={editForm.indefinite}
													ariaLabel={m.end_date()}
													todayLabel={m.today()}
													clearLabel={m.clear()}
													previousMonthLabel={m.previous_month()}
													nextMonthLabel={m.next_month()}
												/></label
											><label class="flex items-end gap-2 pb-2"
												><button
													type="button"
													class:active={editForm.indefinite}
													class="switch"
													aria-label={m.indefinite()}
													aria-pressed={editForm.indefinite}
													onclick={() => (editForm.indefinite = !editForm.indefinite)}
													><span></span></button
												>{m.indefinite()}</label
											>{/if}
										<label class="md:col-span-2"
											>{m.note()}<input bind:value={editForm.note} class="field" /></label
										>
									</div>
									<div>
										<p class="text-sm font-medium text-zinc-700">{m.linked_transactions()}</p>
										{#if plan.transactions.length > 0}
											<div
												class="mt-2 divide-y divide-zinc-200 rounded-ui border border-zinc-200 bg-white"
											>
												{#each plan.transactions as transaction (transaction.transactionId)}
													<div class="grid gap-1 p-3 sm:grid-cols-[1fr_auto] sm:gap-x-4">
														<p class="text-sm font-medium text-zinc-900">
															{formatDate(transaction.bookingDate)} · {transaction.payee ||
																m.not_available()}
														</p>
														<p class="text-sm font-medium text-zinc-900 sm:text-right">
															{euros(transaction.amountCents)}
														</p>
														{#if transaction.description}<p
																class="text-sm text-zinc-600 sm:col-span-2"
															>
																{transaction.description}
															</p>{/if}
														<p class="text-xs text-zinc-500 sm:col-span-2">
															{matchKindLabel(transaction.matchKind)}
															{#if transaction.categoryName}
																· {transaction.categoryName}{/if}
															{#if transaction.scheduledDate}
																· {m.scheduled_for({
																	date: formatDate(transaction.scheduledDate)
																})}{/if}
														</p>
													</div>
												{/each}
											</div>
										{:else}
											<p class="mt-2 text-sm text-zinc-500">{m.no_linked_transactions()}</p>
										{/if}
									</div>
									{#if editError}<p
											class="text-sm font-medium text-red-700"
											role="alert"
											aria-live="polite"
										>
											{editError}
										</p>{/if}
									<div class="flex gap-2">
										<button
											class="button-primary"
											disabled={savingPlanId === plan.id}
											aria-busy={savingPlanId === plan.id}
											onclick={saveEdit}
											>{#if savingPlanId === plan.id}<ButtonSpinner />{/if}{m.save_plan()}</button
										><button class="button-secondary" onclick={resetEdit}>{m.cancel()}</button>
									</div>
								</div>
							{/if}
						</article>
					{:else}<p class="p-4 text-sm text-zinc-600">{m.no_plans()}</p>{/each}
				{/if}
			</div>
		</section>
	{/each}
	<section
		class="overflow-visible rounded-ui border border-zinc-200 bg-white"
		aria-busy={isInitialLoading}
	>
		<div class="border-b border-zinc-200 p-5">
			<h2 class="text-lg font-semibold text-zinc-950">{m.recurring_title()}</h2>
		</div>
		{#if suggestionError}<ErrorAlert class="mx-5 mt-5" message={suggestionError} />{/if}
		{#if suggestionSuccess}
			<div class="mx-5 mt-5">
				<InlineSuccess message={suggestionSuccess} onDismiss={() => (suggestionSuccess = '')} />
			</div>
		{/if}
		<div>
			{#if isInitialLoading}
				{#each Array(3) as _}
					<div class="grid grid-cols-[1fr_auto] gap-4 border-b border-zinc-100 px-5 py-4">
						<div class="space-y-2"><Skeleton class="h-5 w-48" /><Skeleton class="h-4 w-64" /></div>
						<Skeleton class="h-11 w-32" rounded="rounded-ui" />
					</div>
				{/each}
			{:else}
				{#each suggestions as suggestion, suggestionIndex (suggestion.id)}
					{@const value = suggestionForm(suggestion)}
					<article class="border-b border-zinc-100 last:border-0">
						<div class="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
							<div>
								<p class="font-medium text-zinc-950">{suggestion.label || suggestion.payee}</p>
								{#if suggestion.label}<p class="text-sm text-zinc-500">{suggestion.payee}</p>{/if}
								<p class="mt-1 text-sm text-zinc-500">
									{cadenceLabel(suggestion.cadence)} / {formatDate(suggestion.nextDate)} / {suggestion.confidence}%
								</p>
								<p class="mt-1 text-xs text-zinc-500">
									{suggestion.accountName ?? '—'} / {suggestion.categoryName ?? m.no_category()}
								</p>
							</div>
							<div class="text-left lg:text-right">
								<p class="text-sm font-medium text-zinc-950">
									{euros(suggestion.expectedAmountCents)}
								</p>
								<div class="mt-2 flex gap-2 lg:justify-end">
									<button class="button-secondary" onclick={() => reviewSuggestion(suggestion.id)}
										>{m.confirm_recurring()}</button
									><button
										class="button-secondary"
										disabled={ignoringSuggestionId === suggestion.id}
										aria-busy={ignoringSuggestionId === suggestion.id}
										onclick={() => ignore(suggestion.id)}
										>{#if ignoringSuggestionId === suggestion.id}<ButtonSpinner
											/>{/if}{m.ignore_recurring()}</button
									>
								</div>
							</div>
						</div>
						{#if selectedSuggestionId === suggestion.id}
							<div
								class:rounded-b-ui={suggestionIndex === suggestions.length - 1}
								class="grid gap-4 bg-amber-50 p-5"
							>
								<div>
									<h3 class="font-semibold">{m.review_recurring({ payee: suggestion.payee })}</h3>
									<p class="mt-1 text-sm text-zinc-600">
										Confidence {suggestion.confidence}% · interval {suggestion.confidenceFactors
											.interval}/40 · amount {suggestion.confidenceFactors.amount}/30 · history {suggestion
											.confidenceFactors.history}/20 · recency {suggestion.confidenceFactors
											.recency}/10
									</p>
								</div>
								<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
									<label
										>{m.direction()}<Picker
											bind:value={value.direction}
											options={directionOptions}
											placeholder={m.direction()}
											ariaLabel={m.direction()}
											disabled={value.createLiability}
										/></label
									>
									<label
										>{m.category()}<Picker
											bind:value={value.categoryId}
											options={[
												{ value: '', label: m.no_category() },
												...categories
													.filter((category) =>
														value.direction === 'income'
															? category.type === 'income'
															: category.type !== 'income' && category.type !== 'transfer'
													)
													.map((category) => ({ value: category.id, label: category.name }))
											]}
											placeholder={m.no_category()}
											ariaLabel={m.category()}
											disabled={value.createLiability}
										/></label
									>
									<label
										>{m.cadence()}<Picker
											bind:value={value.cadence}
											options={cadenceOptions.filter((option) => option.value !== 'once')}
											placeholder={m.cadence()}
											ariaLabel={m.cadence()}
										/></label
									>
									<label>{m.amount()}<input class="field" bind:value={value.amount} /></label>
									<label class="sm:col-span-2 lg:col-span-4"
										>{m.label()}<input class="field" bind:value={value.label} /></label
									>
									<label
										>{m.next_date()}<DatePicker
											bind:value={value.nextDate}
											ariaLabel={m.next_date()}
											todayLabel={m.today()}
											clearLabel={m.clear()}
											previousMonthLabel={m.previous_month()}
											nextMonthLabel={m.next_month()}
											allowClear={false}
										/></label
									>
									<label
										>{m.end_date()}<DatePicker
											bind:value={value.endDate}
											disabled={value.indefinite}
											ariaLabel={m.end_date()}
											todayLabel={m.today()}
											clearLabel={m.clear()}
											previousMonthLabel={m.previous_month()}
											nextMonthLabel={m.next_month()}
										/></label
									>
									<label class="flex items-end gap-2 pb-2"
										><button
											type="button"
											class:active={value.indefinite}
											class="switch"
											aria-label={m.indefinite()}
											aria-pressed={value.indefinite}
											onclick={() => (value.indefinite = !value.indefinite)}><span></span></button
										>{m.indefinite()}</label
									>
								</div>
								<label class="flex items-center gap-2"
									><button
										type="button"
										class:active={value.createLiability}
										class="switch"
										aria-label={m.create_liability_from_suggestion()}
										aria-pressed={value.createLiability}
										onclick={() => toggleSuggestionLiability(suggestion)}><span></span></button
									>{m.create_liability_from_suggestion()}</label
								>
								{#if value.createLiability}
									<div
										class="grid gap-3 rounded-ui border border-amber-200 bg-white/70 p-4 sm:grid-cols-2 lg:grid-cols-4"
									>
										<label
											>{m.liability_name()}<input
												class="field"
												bind:value={value.liabilityName}
											/></label
										>
										<label
											>{m.remaining_balance()}<input
												class="field"
												inputmode="decimal"
												bind:value={value.liabilityAmount}
											/></label
										>
										<label
											>{m.annual_interest_rate()}<input
												class="field"
												inputmode="decimal"
												placeholder={m.interest_rate_placeholder()}
												bind:value={value.liabilityInterestRate}
											/></label
										>
										<label
											>{m.as_of_date()}<DatePicker
												bind:value={value.liabilityAsOfDate}
												ariaLabel={m.as_of_date()}
												todayLabel={m.today()}
												clearLabel={m.clear()}
												previousMonthLabel={m.previous_month()}
												nextMonthLabel={m.next_month()}
												allowClear={false}
											/></label
										>
									</div>
								{/if}
								<div class="rounded border border-amber-200 bg-white p-3">
									<p class="text-sm font-medium text-zinc-700">{m.supporting_transactions()}</p>
									{#each suggestion.evidence as item (item.transactionId)}<div
											class="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-sm"
										>
											<div class="min-w-0">
												<p>{formatDate(item.bookingDate)} · {item.payee ?? suggestion.payee}</p>
												{#if item.description}<p
														class="mt-1 break-words text-xs leading-5 text-zinc-500"
													>
														<span class="font-medium text-zinc-600">{m.transaction_purpose()}:</span
														>
														{item.description}
													</p>{/if}
											</div>
											<span class="shrink-0">{euros(item.amountCents)}</span>
										</div>{/each}
								</div>
								<div class="flex gap-2">
									<button
										class="button-primary"
										disabled={confirmingSuggestionId === suggestion.id}
										aria-busy={confirmingSuggestionId === suggestion.id}
										onclick={() => confirm(suggestion)}
										>{#if confirmingSuggestionId === suggestion.id}<ButtonSpinner
											/>{/if}{m.confirm_recurring()}</button
									><button class="button-secondary" onclick={cancelSuggestion}>{m.cancel()}</button>
								</div>
							</div>
						{/if}
					</article>
				{:else}<p class="p-5 text-sm text-zinc-600">{m.no_recurring_groups()}</p>{/each}
			{/if}
		</div>
	</section>
	{#if isInitialLoading}
		<section class="rounded-ui border border-zinc-200 bg-white p-5" aria-busy="true">
			<Skeleton class="h-6 w-40" />
			<div class="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{#each Array(8) as _}<Skeleton class="h-11 w-full" rounded="rounded-ui" />{/each}
			</div>
		</section>
	{:else}
		{@render manualPlanForm()}
	{/if}
	<section
		class="overflow-hidden rounded-ui border border-zinc-200 bg-white"
		aria-busy={isInitialLoading}
	>
		<div class="border-b border-zinc-200 p-5">
			<h2 class="text-lg font-semibold text-zinc-950">{m.liabilities_title()}</h2>
		</div>
		{#if liabilityError}<ErrorAlert class="mx-5 mt-5" message={liabilityError} />{/if}
		{#if liabilitySuccess}
			<div class="mx-5 mt-5">
				<InlineSuccess message={liabilitySuccess} onDismiss={() => (liabilitySuccess = '')} />
			</div>
		{/if}
		<div>
			{#if isInitialLoading}
				{#each Array(2) as _}<div class="border-b border-zinc-100 p-5">
						<Skeleton class="h-32 w-full" rounded="rounded-ui" />
					</div>{/each}
			{:else}
				{#each liabilities as liability (liability.id)}<article
						class="border-b border-zinc-100 p-5 last:border-0"
					>
						<header class="flex flex-wrap items-start justify-between gap-4">
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="font-medium text-zinc-950">
										{liability.plan?.label || liability.name}
									</h3>
									<span
										class="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600"
										>{liabilityStatusLabel(liability.status)}</span
									>
								</div>
								<p class="mt-1 text-sm text-zinc-600">
									{liability.name}{#if liability.plan?.counterparty && liability.plan.counterparty !== liability.name}
										· {liability.plan.counterparty}{/if}
								</p>
								{#if liability.accountName || liability.plan?.categoryName}<p
										class="mt-1 text-xs text-zinc-500"
									>
										{liability.accountName ?? m.all_accounts()}{#if liability.plan?.categoryName}
											· {liability.plan.categoryName}{/if}
									</p>{/if}
							</div>
							<div class="text-right">
								<p class="text-xs font-medium text-zinc-500">{m.remaining_balance()}</p>
								<p class="mt-1 text-lg font-medium text-zinc-950">{euros(liability.amountCents)}</p>
							</div>
						</header>

						<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<div class="rounded-ui bg-zinc-50 p-3">
								<p class="text-xs font-medium text-zinc-500">{m.liability_installment()}</p>
								<p class="mt-1 text-sm font-medium text-zinc-950">
									{liability.plan ? euros(liability.plan.amountCents) : '—'}
								</p>
								{#if liability.plan}<p class="mt-1 text-xs text-zinc-500">
										{cadenceLabel(liability.plan.cadence)}
									</p>{/if}
							</div>
							<div class="rounded-ui bg-zinc-50 p-3">
								<p class="text-xs font-medium text-zinc-500">{m.liability_next_payment()}</p>
								<p class="mt-1 text-sm font-medium text-zinc-950">
									{liability.plan ? formatDate(liability.plan.nextDate) : '—'}
								</p>
								{#if liability.plan}<p class="mt-1 text-xs text-zinc-500">
										{statusLabel(liability.plan.status)}
									</p>{/if}
							</div>
							<div class="rounded-ui bg-zinc-50 p-3">
								<p class="text-xs font-medium text-zinc-500">{m.liability_next_split()}</p>
								{#if liability.projection}<p class="mt-1 text-sm font-medium text-zinc-950">
										{m.liability_interest()}
										{euros(liability.projection.nextInterestCents)}
									</p>
									<p class="mt-1 text-xs text-zinc-500">
										{m.liability_principal()}
										{euros(liability.projection.nextPrincipalCents)}
									</p>{:else}<p class="mt-1 text-sm font-medium text-zinc-950">—</p>{/if}
							</div>
							<div class="rounded-ui bg-zinc-50 p-3">
								<p class="text-xs font-medium text-zinc-500">{m.liability_estimated_payoff()}</p>
								{#if liability.projection?.estimatedPayoffDate && liability.projection.estimatedRemainingPayments !== null}<p
										class="mt-1 text-sm font-medium text-zinc-950"
									>
										{formatDate(liability.projection.estimatedPayoffDate)}
									</p>
									<p class="mt-1 text-xs text-zinc-500">
										{m.liability_payments_remaining({
											count: liability.projection.estimatedRemainingPayments
										})}
									</p>{:else}<p class="mt-1 text-sm font-medium text-zinc-950">—</p>{/if}
							</div>
						</div>

						<div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
							<span
								>{m.annual_interest_rate()}: {liability.annualInterestRateBps === null
									? '—'
									: `${(liability.annualInterestRateBps / 100).toFixed(2)}%`}</span
							>
							<span>{m.as_of_date()}: {formatDate(liability.asOfDate)}</span>
							{#if liability.projection?.estimatedRemainingInterestCents !== null && liability.projection}<span
									>{m.liability_estimated_interest()}: {euros(
										liability.projection.estimatedRemainingInterestCents
									)}</span
								>{/if}
							{#if liability.plan?.endDate}<span
									>{m.end_date()}: {formatDate(liability.plan.endDate)}</span
								>{/if}
						</div>
						{#if liability.projection && liability.projection.nextPrincipalCents <= 0}<p
								class="mt-3 text-sm font-medium text-amber-700"
							>
								{m.liability_not_amortizing()}
							</p>{/if}
						{#if liability.note}<p class="mt-3 text-sm text-zinc-600">{liability.note}</p>{/if}
						<div class="mt-4">
							<button
								class="button-secondary"
								disabled={deletingLiabilityId === liability.id}
								aria-busy={deletingLiabilityId === liability.id}
								onclick={() => removeLiability(liability.id)}
								>{#if deletingLiabilityId === liability.id}<ButtonSpinner
									/>{/if}{m.delete_liability()}</button
							>
						</div>
					</article>{:else}<p class="p-4 text-sm text-zinc-600">{m.no_liabilities()}</p>{/each}
			{/if}
		</div>
	</section>
</section>

<style>
	label {
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.25rem;
		color: #3f3f46;
	}
	.field {
		display: block;
		width: 100%;
		margin-top: 0.35rem;
		border: 1px solid #d4d4d8;
		border-radius: 0.75rem;
		padding: 0.65rem 1rem;
		background: white;
	}
	.button-primary,
	.button-secondary {
		display: inline-flex;
		gap: 0.5rem;
		height: 44px;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		font-size: 0.875rem;
		line-height: 1.25rem;
	}
	.button-primary:disabled,
	.button-secondary:disabled {
		opacity: 0.5;
	}
	.button-primary {
		border-radius: 999px;
		background: #09090b;
		color: white;
		padding: 0 1.1rem;
		font-weight: 600;
	}
	.button-secondary {
		border: 1px solid #d4d4d8;
		border-radius: 999px;
		padding: 0 0.9rem;
	}
	.switch {
		width: 52px;
		height: 32px;
		border-radius: 999px;
		background: #c7c7cc;
		padding: 2px;
		transition: 0.2s;
	}
	.switch span {
		display: block;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: white;
		transition: 0.2s;
	}
	.switch.active {
		background: #34c759;
	}
	.switch.active span {
		transform: translateX(20px);
	}
</style>
