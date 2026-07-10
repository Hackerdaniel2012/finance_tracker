<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { onMount } from 'svelte';

	type ContractKind = 'fixed_cost' | 'subscription' | 'salary' | 'income' | 'other';
	type ContractCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
	type ContractStatus = 'active' | 'paused' | 'ended';
	type PlannedPaymentStatus = 'planned' | 'paid' | 'cancelled';
	type PlannedIncomeStatus = 'planned' | 'received' | 'cancelled';
	type RecurringStatus = 'suggested' | 'confirmed' | 'ignored';
	type LiabilityStatus = 'active' | 'cleared';

	interface Account {
		id: string;
		name: string;
		institution: string | null;
		profile: { id: string; label: string; bankId: string } | null;
	}

	interface Profile {
		id: string;
		accountId: string;
		label: string;
		bankId: string;
		status: string;
	}

	interface Category {
		id: string;
		name: string;
		type: string;
	}

	interface Contract {
		id: string;
		accountId: string | null;
		accountName: string | null;
		profileId: string | null;
		profileLabel: string | null;
		categoryId: string | null;
		categoryName: string | null;
		name: string;
		payee: string | null;
		kind: ContractKind;
		cadence: ContractCadence;
		expectedAmountCents: number;
		nextDate: string;
		endDate: string | null;
		status: ContractStatus;
		source: string;
	}

	interface PlannedPayment {
		id: string;
		accountId: string | null;
		accountName: string | null;
		categoryId: string | null;
		categoryName: string | null;
		label: string | null;
		payee: string;
		amountCents: number;
		dueDate: string;
		status: PlannedPaymentStatus;
		note: string | null;
	}

	interface PlannedIncome {
		id: string;
		accountId: string | null;
		accountName: string | null;
		categoryId: string | null;
		categoryName: string | null;
		payer: string;
		amountCents: number;
		dueDate: string;
		status: PlannedIncomeStatus;
		note: string | null;
	}

	interface Liability {
		id: string;
		accountId: string | null;
		accountName: string | null;
		name: string;
		amountCents: number;
		asOfDate: string;
		status: LiabilityStatus;
		note: string | null;
	}

	interface RecurringGroup {
		id: string;
		accountName: string | null;
		categoryId: string | null;
		categoryName: string | null;
		label: string | null;
		payee: string;
		direction: 'incoming' | 'outgoing' | null;
		cadence: ContractCadence;
		expectedAmountCents: number;
		nextDate: string | null;
		status: RecurringStatus;
		confidence: number;
		confidenceFactors: { interval: number; amount: number; history: number; recency: number };
		needsReview: boolean;
		transactionCount: number;
		evidence: Array<{
			transactionId: string;
			bookingDate: string;
			amountCents: number;
			payee: string | null;
		}>;
	}

	interface UpcomingPayment {
		id: string;
		accountName: string | null;
		categoryName: string | null;
		payee: string;
		amountCents: number;
		dueDate: string;
		note: string | null;
	}

	interface UpcomingIncome {
		id: string;
		accountName: string | null;
		categoryName: string | null;
		payer: string;
		amountCents: number;
		dueDate: string;
		note: string | null;
	}

	interface BalanceProjection {
		asOf: string;
		projectionDate: string;
		manualNextSalaryDate: string | null;
		nextIncome: UpcomingIncome | null;
		currentBalanceCents: number;
		upcomingPaymentCents: number;
		projectedBalanceCents: number;
		upcomingPayments: UpcomingPayment[];
	}

	const contractKinds: ContractKind[] = ['fixed_cost', 'subscription', 'salary', 'income', 'other'];
	const cadences: ContractCadence[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
	const contractStatuses: ContractStatus[] = ['active', 'paused', 'ended'];
	const paymentStatuses: PlannedPaymentStatus[] = ['planned', 'paid', 'cancelled'];
	const incomeStatuses: PlannedIncomeStatus[] = ['planned', 'received', 'cancelled'];
	const liabilityStatuses: LiabilityStatus[] = ['active', 'cleared'];

	let accounts = $state<Account[]>([]);
	let profiles = $state<Profile[]>([]);
	let categories = $state<Category[]>([]);
	let contracts = $state<Contract[]>([]);
	let plannedPayments = $state<PlannedPayment[]>([]);
	let plannedIncome = $state<PlannedIncome[]>([]);
	let liabilities = $state<Liability[]>([]);
	let recurringGroups = $state<RecurringGroup[]>([]);
	let selectedRecurring = $state<RecurringGroup | null>(null);
	let recurringDirection = $state<'incoming' | 'outgoing'>('outgoing');
	let recurringCategoryId = $state('');
	let recurringLabel = $state('');
	let recurringCadence = $state<ContractCadence>('monthly');
	let recurringAmount = $state('');
	let recurringNextDate = $state(todayIso());
	let upcomingPayments = $state<UpcomingPayment[]>([]);
	let upcomingIncome = $state<UpcomingIncome[]>([]);
	let projection = $state<BalanceProjection | null>(null);
	let status = $state(m.planning_status_loading());
	let error = $state<string | null>(null);
	let isSavingContract = $state(false);
	let isSavingPayment = $state(false);
	let isSavingIncome = $state(false);
	let isSavingLiability = $state(false);
	let isUpdatingRecurring = $state(false);
	let editingContractId = $state<string | null>(null);
	let editContractName = $state('');
	let editContractPayee = $state('');
	let editContractKind = $state<ContractKind>('fixed_cost');
	let editContractCadence = $state<ContractCadence>('monthly');
	let editContractAmount = $state('');
	let editContractNextDate = $state(todayIso());
	let editContractEndDate = $state('');
	let editContractStatus = $state<ContractStatus>('active');
	let editContractAccountId = $state('');
	let editContractProfileId = $state('');
	let editContractCategoryId = $state('');
	let editingPaymentId = $state<string | null>(null);
	let editPaymentPayee = $state('');
	let editPaymentAmount = $state('');
	let editPaymentDueDate = $state(todayIso());
	let editPaymentStatus = $state<PlannedPaymentStatus>('planned');
	let editPaymentAccountId = $state('');
	let editPaymentCategoryId = $state('');
	let editPaymentNote = $state('');
	let editingIncomeId = $state<string | null>(null);
	let editIncomePayer = $state('');
	let editIncomeAmount = $state('');
	let editIncomeDueDate = $state(todayIso());
	let editIncomeStatus = $state<PlannedIncomeStatus>('planned');
	let editIncomeAccountId = $state('');
	let editIncomeCategoryId = $state('');
	let editIncomeNote = $state('');

	let contractName = $state('');
	let contractPayee = $state('');
	let contractKind = $state<ContractKind>('fixed_cost');
	let contractCadence = $state<ContractCadence>('monthly');
	let contractAmount = $state('');
	let contractNextDate = $state(todayIso());
	let contractEndDate = $state('');
	let contractStatus = $state<ContractStatus>('active');
	let contractAccountId = $state('');
	let contractProfileId = $state('');
	let contractCategoryId = $state('');

	let paymentPayee = $state('');
	let paymentAmount = $state('');
	let paymentDueDate = $state(todayIso());
	let paymentStatus = $state<PlannedPaymentStatus>('planned');
	let paymentAccountId = $state('');
	let paymentCategoryId = $state('');
	let paymentNote = $state('');

	let incomePayer = $state('');
	let incomeAmount = $state('');
	let incomeDueDate = $state(todayIso());
	let incomeStatus = $state<PlannedIncomeStatus>('planned');
	let incomeAccountId = $state('');
	let incomeCategoryId = $state('');
	let incomeNote = $state('');

	let liabilityName = $state('');
	let liabilityAmount = $state('');
	let liabilityAsOfDate = $state(todayIso());
	let liabilityStatus = $state<LiabilityStatus>('active');
	let liabilityAccountId = $state('');
	let liabilityNote = $state('');
	let manualNextSalaryDate = $state('');

	const upcomingPaymentTotal = $derived(
		upcomingPayments.reduce((sum, payment) => sum + payment.amountCents, 0)
	);
	const upcomingIncomeTotal = $derived(
		upcomingIncome.reduce((sum, income) => sum + income.amountCents, 0)
	);
	const activeLiabilityTotal = $derived(
		liabilities
			.filter((liability) => liability.status === 'active')
			.reduce((sum, liability) => sum + liability.amountCents, 0)
	);

	onMount(() => {
		void loadPlanningState();
	});

	async function loadPlanningState() {
		status = m.planning_status_loading();
		error = null;

		try {
			const [
				accountPayload,
				profilePayload,
				categoryPayload,
				contractPayload,
				paymentPayload,
				incomePayload,
				liabilityPayload,
				recurringPayload,
				upcomingPaymentPayload,
				upcomingIncomePayload,
				projectionPayload
			] = await Promise.all([
				fetchJson<{ accounts: Account[] }>('/api/accounts'),
				fetchJson<{ profiles: Profile[] }>('/api/profiles'),
				fetchJson<{ categories: Category[] }>('/api/categories'),
				fetchJson<{ contracts: Contract[] }>('/api/contracts'),
				fetchJson<{ plannedPayments: PlannedPayment[] }>('/api/planned-payments'),
				fetchJson<{ plannedIncome: PlannedIncome[] }>('/api/planned-income'),
				fetchJson<{ liabilities: Liability[] }>('/api/liabilities'),
				fetchJson<{ recurringGroups: RecurringGroup[] }>('/api/recurring'),
				fetchJson<{ upcomingPayments: UpcomingPayment[] }>('/api/upcoming-payments'),
				fetchJson<{ upcomingIncome: UpcomingIncome[] }>('/api/upcoming-income'),
				fetchJson<{ projection: BalanceProjection }>(balanceBeforeSalaryUrl())
			]);

			accounts = accountPayload.accounts;
			profiles = profilePayload.profiles.filter((profile) => profile.status === 'active');
			categories = categoryPayload.categories;
			contracts = contractPayload.contracts;
			plannedPayments = paymentPayload.plannedPayments;
			plannedIncome = incomePayload.plannedIncome;
			liabilities = liabilityPayload.liabilities;
			recurringGroups = recurringPayload.recurringGroups;
			upcomingPayments = upcomingPaymentPayload.upcomingPayments;
			upcomingIncome = upcomingIncomePayload.upcomingIncome;
			projection = projectionPayload.projection;
			status = m.planning_status_ready();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		}
	}

	async function createContract(event: SubmitEvent) {
		event.preventDefault();
		isSavingContract = true;
		error = null;

		try {
			await fetchJson<{ contract: Contract }>('/api/contracts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: contractAccountId || null,
					profileId: contractProfileId || null,
					categoryId: contractCategoryId || null,
					name: contractName,
					payee: contractPayee || null,
					kind: contractKind,
					cadence: contractCadence,
					expectedAmountCents: eurosToCents(contractAmount),
					nextDate: contractNextDate,
					endDate: contractEndDate || null,
					status: contractStatus,
					source: 'manual'
				})
			});

			contractName = '';
			contractPayee = '';
			contractAmount = '';
			contractEndDate = '';
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		} finally {
			isSavingContract = false;
		}
	}

	async function updateContractStatus(contract: Contract, nextStatus: ContractStatus) {
		await patchAndReload('/api/contracts', { id: contract.id, status: nextStatus });
	}

	function startContractEdit(contract: Contract) {
		editingContractId = contract.id;
		editContractName = contract.name;
		editContractPayee = contract.payee ?? '';
		editContractKind = contract.kind;
		editContractCadence = contract.cadence;
		editContractAmount = (contract.expectedAmountCents / 100).toFixed(2);
		editContractNextDate = contract.nextDate;
		editContractEndDate = contract.endDate ?? '';
		editContractStatus = contract.status;
		editContractAccountId = contract.accountId ?? '';
		editContractProfileId = contract.profileId ?? '';
		editContractCategoryId = contract.categoryId ?? '';
	}

	function cancelContractEdit() {
		editingContractId = null;
	}

	async function saveContract(event: SubmitEvent, contractId: string) {
		event.preventDefault();
		error = null;

		try {
			await fetchJson<{ contract: Contract }>('/api/contracts', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					id: contractId,
					accountId: editContractAccountId || null,
					profileId: editContractProfileId || null,
					categoryId: editContractCategoryId || null,
					name: editContractName,
					payee: editContractPayee || null,
					kind: editContractKind,
					cadence: editContractCadence,
					expectedAmountCents: eurosToCents(editContractAmount),
					nextDate: editContractNextDate,
					endDate: editContractEndDate || null,
					status: editContractStatus
				})
			});
			editingContractId = null;
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		}
	}

	async function createPayment(event: SubmitEvent) {
		event.preventDefault();
		isSavingPayment = true;
		error = null;

		try {
			await fetchJson<{ plannedPayment: PlannedPayment }>('/api/planned-payments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: paymentAccountId || null,
					categoryId: paymentCategoryId || null,
					payee: paymentPayee,
					amountCents: eurosToCents(paymentAmount),
					dueDate: paymentDueDate,
					status: paymentStatus,
					note: paymentNote || null
				})
			});

			paymentPayee = '';
			paymentAmount = '';
			paymentNote = '';
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		} finally {
			isSavingPayment = false;
		}
	}

	async function updatePaymentStatus(payment: PlannedPayment, nextStatus: PlannedPaymentStatus) {
		await patchAndReload('/api/planned-payments', { id: payment.id, status: nextStatus });
	}

	function startPaymentEdit(payment: PlannedPayment) {
		editingPaymentId = payment.id;
		editPaymentPayee = payment.payee;
		editPaymentAmount = (payment.amountCents / 100).toFixed(2);
		editPaymentDueDate = payment.dueDate;
		editPaymentStatus = payment.status;
		editPaymentAccountId = payment.accountId ?? '';
		editPaymentCategoryId = payment.categoryId ?? '';
		editPaymentNote = payment.note ?? '';
	}

	function cancelPaymentEdit() {
		editingPaymentId = null;
	}

	async function savePayment(event: SubmitEvent, paymentId: string) {
		event.preventDefault();
		error = null;

		try {
			await fetchJson<{ plannedPayment: PlannedPayment }>('/api/planned-payments', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					id: paymentId,
					accountId: editPaymentAccountId || null,
					categoryId: editPaymentCategoryId || null,
					payee: editPaymentPayee,
					amountCents: eurosToCents(editPaymentAmount),
					dueDate: editPaymentDueDate,
					status: editPaymentStatus,
					note: editPaymentNote || null
				})
			});
			editingPaymentId = null;
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		}
	}

	async function createIncome(event: SubmitEvent) {
		event.preventDefault();
		isSavingIncome = true;
		error = null;

		try {
			await fetchJson<{ plannedIncome: PlannedIncome }>('/api/planned-income', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: incomeAccountId || null,
					categoryId: incomeCategoryId || null,
					payer: incomePayer,
					amountCents: eurosToCents(incomeAmount),
					dueDate: incomeDueDate,
					status: incomeStatus,
					note: incomeNote || null
				})
			});

			incomePayer = '';
			incomeAmount = '';
			incomeNote = '';
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		} finally {
			isSavingIncome = false;
		}
	}

	async function updateIncomeStatus(income: PlannedIncome, nextStatus: PlannedIncomeStatus) {
		await patchAndReload('/api/planned-income', { id: income.id, status: nextStatus });
	}

	function startIncomeEdit(income: PlannedIncome) {
		editingIncomeId = income.id;
		editIncomePayer = income.payer;
		editIncomeAmount = (income.amountCents / 100).toFixed(2);
		editIncomeDueDate = income.dueDate;
		editIncomeStatus = income.status;
		editIncomeAccountId = income.accountId ?? '';
		editIncomeCategoryId = income.categoryId ?? '';
		editIncomeNote = income.note ?? '';
	}

	function cancelIncomeEdit() {
		editingIncomeId = null;
	}

	async function saveIncome(event: SubmitEvent, incomeId: string) {
		event.preventDefault();
		error = null;

		try {
			await fetchJson<{ plannedIncome: PlannedIncome }>('/api/planned-income', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					id: incomeId,
					accountId: editIncomeAccountId || null,
					categoryId: editIncomeCategoryId || null,
					payer: editIncomePayer,
					amountCents: eurosToCents(editIncomeAmount),
					dueDate: editIncomeDueDate,
					status: editIncomeStatus,
					note: editIncomeNote || null
				})
			});
			editingIncomeId = null;
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		}
	}

	async function createLiability(event: SubmitEvent) {
		event.preventDefault();
		isSavingLiability = true;
		error = null;

		try {
			await fetchJson<{ liability: Liability }>('/api/liabilities', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: liabilityAccountId || null,
					name: liabilityName,
					amountCents: eurosToCents(liabilityAmount),
					asOfDate: liabilityAsOfDate,
					status: liabilityStatus,
					note: liabilityNote || null
				})
			});

			liabilityName = '';
			liabilityAmount = '';
			liabilityNote = '';
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		} finally {
			isSavingLiability = false;
		}
	}

	async function applyManualNextSalaryDate(event: SubmitEvent) {
		event.preventDefault();
		await loadPlanningState();
	}

	async function updateLiabilityStatus(liability: Liability, nextStatus: LiabilityStatus) {
		await patchAndReload('/api/liabilities', { id: liability.id, status: nextStatus });
	}

	async function deleteLiability(liability: Liability) {
		error = null;
		try {
			await fetchJson('/api/liabilities', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: liability.id })
			});
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		}
	}

	async function updateRecurringStatus(group: RecurringGroup, nextStatus: RecurringStatus) {
		isUpdatingRecurring = true;
		try {
			await fetchJson<{ recurringGroup: RecurringGroup }>(`/api/recurring/${group.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status: nextStatus })
			});
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		} finally {
			isUpdatingRecurring = false;
		}
	}

	async function refreshRecurringSuggestions() {
		isUpdatingRecurring = true;
		try {
			await fetchJson('/api/recurring', { method: 'POST' });
			await loadPlanningState();
		} catch {
			error = m.planning_status_error();
		} finally {
			isUpdatingRecurring = false;
		}
	}

	function reviewRecurring(group: RecurringGroup) {
		selectedRecurring = group;
		recurringDirection = group.direction ?? 'outgoing';
		recurringCategoryId = group.categoryId ?? '';
		recurringLabel = group.label ?? '';
		recurringCadence = group.cadence;
		recurringAmount = String(group.expectedAmountCents / 100);
		recurringNextDate = group.nextDate ?? todayIso();
	}

	async function confirmRecurring(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedRecurring || !recurringCategoryId) return;
		isUpdatingRecurring = true;
		try {
			await fetchJson(`/api/recurring/${selectedRecurring.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					status: 'confirmed',
					direction: recurringDirection,
					categoryId: recurringCategoryId,
					label: recurringLabel || null,
					cadence: recurringCadence,
					expectedAmountCents: eurosToCents(recurringAmount),
					nextDate: recurringNextDate
				})
			});
			selectedRecurring = null;
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			error = m.planning_status_error();
		} finally {
			isUpdatingRecurring = false;
		}
	}

	async function patchAndReload(url: string, body: Record<string, string>) {
		error = null;
		try {
			await fetchJson(url, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			status = m.planning_status_saved();
			await loadPlanningState();
		} catch {
			status = m.planning_status_error();
			error = m.planning_status_error();
		}
	}

	async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
		return fetchJsonWithRetry<T>(url, init);
	}

	function balanceBeforeSalaryUrl(): string {
		if (manualNextSalaryDate) {
			return `/api/balance-before-salary?nextSalaryDate=${encodeURIComponent(manualNextSalaryDate)}`;
		}

		return '/api/balance-before-salary';
	}

	function todayIso(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function eurosToCents(value: string): number {
		return Math.round(Number(value.replace(',', '.')) * 100);
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
	}

	function formatDate(value: string | null): string {
		if (!value) return m.not_available();
		return new Date(`${value}T00:00:00`).toLocaleDateString();
	}

	function kindLabel(value: ContractKind): string {
		return {
			fixed_cost: m.contract_kind_fixed_cost(),
			subscription: m.contract_kind_subscription(),
			salary: m.contract_kind_salary(),
			income: m.contract_kind_income(),
			other: m.contract_kind_other()
		}[value];
	}

	function cadenceLabel(value: ContractCadence): string {
		return {
			weekly: m.cadence_weekly(),
			biweekly: m.cadence_biweekly(),
			monthly: m.cadence_monthly(),
			quarterly: m.cadence_quarterly(),
			yearly: m.cadence_yearly()
		}[value];
	}

	function contractStatusLabel(value: ContractStatus): string {
		return {
			active: m.status_active(),
			paused: m.status_paused(),
			ended: m.status_ended()
		}[value];
	}

	function paymentStatusLabel(value: PlannedPaymentStatus): string {
		return {
			planned: m.status_planned(),
			paid: m.status_paid(),
			cancelled: m.status_cancelled()
		}[value];
	}

	function incomeStatusLabel(value: PlannedIncomeStatus): string {
		return {
			planned: m.status_planned(),
			received: m.status_received(),
			cancelled: m.status_cancelled()
		}[value];
	}

	function liabilityStatusLabel(value: LiabilityStatus): string {
		return {
			active: m.status_active(),
			cleared: m.status_cleared()
		}[value];
	}
</script>

<svelte:head>
	<title>{m.planning_title()} / {m.app_title()}</title>
	<meta name="description" content={m.planning_subtitle()} />
</svelte:head>

<main class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:py-8">
	<section class="space-y-2">
		<h1 class="text-3xl font-semibold tracking-normal text-zinc-950">{m.planning_title()}</h1>
		<p class="max-w-3xl text-sm leading-6 text-zinc-600">{m.planning_subtitle()}</p>
		<p class="text-sm text-zinc-500">{status}</p>
	</section>

	{#if error}
		<p class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
	{/if}

	<section class="grid gap-4 md:grid-cols-3">
		<div class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<p class="text-sm text-zinc-500">{m.upcoming_payments()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">{centsToEuros(upcomingPaymentTotal)}</p>
		</div>
		<div class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<p class="text-sm text-zinc-500">{m.upcoming_income()}</p>
			<p class="mt-2 text-2xl font-semibold text-emerald-700">
				{centsToEuros(upcomingIncomeTotal)}
			</p>
		</div>
		<div class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<p class="text-sm text-zinc-500">{m.balance_before_salary()}</p>
			<p class="mt-2 text-2xl font-semibold text-zinc-950">
				{projection ? centsToEuros(projection.projectedBalanceCents) : m.not_available()}
			</p>
			<p class="mt-1 text-xs text-zinc-500">
				{projection ? formatDate(projection.projectionDate) : m.not_available()}
			</p>
		</div>
		<div class="rounded border border-zinc-200 bg-white p-5 shadow-sm md:col-span-3">
			<p class="text-sm text-zinc-500">{m.active_liabilities()}</p>
			<p class="mt-2 text-2xl font-semibold text-red-700">
				{centsToEuros(activeLiabilityTotal)}
			</p>
		</div>
	</section>

	<section class="grid gap-6 xl:grid-cols-3">
		<section class="rounded border border-zinc-200 bg-white shadow-sm xl:col-span-2">
			<div class="border-b border-zinc-200 p-5">
				<h2 class="text-lg font-semibold text-zinc-950">{m.contracts_title()}</h2>
			</div>
			<div class="divide-y divide-zinc-100">
				{#each contracts as contract (contract.id)}
					{#if editingContractId === contract.id}
						<form
							class="grid gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-4"
							onsubmit={(event) => {
								event.preventDefault();
								void saveContract(event, contract.id);
							}}
						>
							<div class="grid gap-4 sm:grid-cols-2">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.contract_name()}</span>
									<input
										class="w-full rounded border-zinc-300"
										bind:value={editContractName}
										required
									/>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.payee()}</span>
									<input class="w-full rounded border-zinc-300" bind:value={editContractPayee} />
								</label>
							</div>
							<div class="grid gap-4 sm:grid-cols-4">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.contract_kind()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editContractKind}>
										{#each contractKinds as option (option)}
											<option value={option}>{kindLabel(option)}</option>
										{/each}
									</select>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.cadence()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editContractCadence}>
										{#each cadences as option (option)}
											<option value={option}>{cadenceLabel(option)}</option>
										{/each}
									</select>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.amount()}</span>
									<input
										class="w-full rounded border-zinc-300"
										bind:value={editContractAmount}
										inputmode="decimal"
										required
									/>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.status()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editContractStatus}>
										{#each contractStatuses as option (option)}
											<option value={option}>{contractStatusLabel(option)}</option>
										{/each}
									</select>
								</label>
							</div>
							<div class="grid gap-4 sm:grid-cols-2">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.next_date()}</span>
									<input
										class="w-full rounded border-zinc-300"
										type="date"
										bind:value={editContractNextDate}
										required
									/>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.end_date()}</span>
									<input
										class="w-full rounded border-zinc-300"
										type="date"
										bind:value={editContractEndDate}
									/>
								</label>
							</div>
							<div class="grid gap-4 sm:grid-cols-3">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.account()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editContractAccountId}>
										<option value="">{m.not_available()}</option>
										{#each accounts as account (account.id)}
											<option value={account.id}>{account.name}</option>
										{/each}
									</select>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.category()}</span>
									<select
										class="w-full rounded border-zinc-300"
										bind:value={editContractCategoryId}
									>
										<option value="">{m.uncategorized()}</option>
										{#each categories as category (category.id)}
											<option value={category.id}>{category.name}</option>
										{/each}
									</select>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.profile_title()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editContractProfileId}>
										<option value="">{m.not_available()}</option>
										{#each profiles as profile (profile.id)}
											<option value={profile.id}>{profile.label}</option>
										{/each}
									</select>
								</label>
							</div>
							<div class="flex flex-wrap gap-2">
								<button
									class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
									type="submit">{m.save_contract()}</button
								>
								<button
									class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700"
									type="button"
									onclick={cancelContractEdit}>{m.cancel_edit()}</button
								>
							</div>
						</form>
					{:else}
						<div class="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
							<div>
								<p class="font-medium text-zinc-950">{contract.name}</p>
								<p class="mt-1 text-sm text-zinc-500">
									{kindLabel(contract.kind)} / {cadenceLabel(contract.cadence)} / {formatDate(
										contract.nextDate
									)}
								</p>
								<p class="mt-1 text-xs text-zinc-500">
									{contract.accountName ?? m.not_available()} / {contract.categoryName ??
										m.uncategorized()}
								</p>
							</div>
							<div class="text-left lg:text-right">
								<p class="font-semibold text-zinc-950">
									{centsToEuros(contract.expectedAmountCents)}
								</p>
								<div class="mt-2 flex flex-wrap gap-2 lg:justify-end">
									<button
										class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
										type="button"
										onclick={() => startContractEdit(contract)}>{m.edit_contract()}</button
									>
									{#each contractStatuses as option (option)}
										<button
											class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:bg-zinc-100"
											type="button"
											disabled={contract.status === option}
											onclick={() => updateContractStatus(contract, option)}
										>
											{contractStatusLabel(option)}
										</button>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				{:else}
					<p class="p-5 text-sm text-zinc-600">{m.no_contracts()}</p>
				{/each}
			</div>
		</section>

		<form class="rounded border border-zinc-200 bg-white p-5 shadow-sm" onsubmit={createContract}>
			<h2 class="text-lg font-semibold text-zinc-950">{m.new_contract()}</h2>
			<div class="mt-5 grid gap-4">
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.contract_name()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={contractName} required />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.payee()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={contractPayee} />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.contract_kind()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={contractKind}>
							{#each contractKinds as option (option)}
								<option value={option}>{kindLabel(option)}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.cadence()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={contractCadence}>
							{#each cadences as option (option)}
								<option value={option}>{cadenceLabel(option)}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.amount()}</span>
						<input
							class="w-full rounded border-zinc-300"
							bind:value={contractAmount}
							inputmode="decimal"
							required
						/>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.next_date()}</span>
						<input
							class="w-full rounded border-zinc-300"
							type="date"
							bind:value={contractNextDate}
							required
						/>
					</label>
				</div>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.end_date()}</span>
					<input class="w-full rounded border-zinc-300" type="date" bind:value={contractEndDate} />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.account()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={contractAccountId}>
							<option value="">{m.not_available()}</option>
							{#each accounts as account (account.id)}
								<option value={account.id}>{account.name}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.category()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={contractCategoryId}>
							<option value="">{m.uncategorized()}</option>
							{#each categories as category (category.id)}
								<option value={category.id}>{category.name}</option>
							{/each}
						</select>
					</label>
				</div>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.profile_title()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={contractProfileId}>
						<option value="">{m.not_available()}</option>
						{#each profiles as profile (profile.id)}
							<option value={profile.id}>{profile.label}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.status()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={contractStatus}>
						{#each contractStatuses as option (option)}
							<option value={option}>{contractStatusLabel(option)}</option>
						{/each}
					</select>
				</label>
				<button
					class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					type="submit"
					disabled={isSavingContract}
				>
					{m.create_contract()}
				</button>
			</div>
		</form>
	</section>

	<section class="grid gap-6 xl:grid-cols-2">
		<section class="rounded border border-zinc-200 bg-white shadow-sm">
			<div class="border-b border-zinc-200 p-5">
				<h2 class="text-lg font-semibold text-zinc-950">{m.planned_payments_title()}</h2>
			</div>
			<div class="divide-y divide-zinc-100">
				{#each plannedPayments as payment (payment.id)}
					{#if editingPaymentId === payment.id}
						<form
							class="grid gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-4"
							onsubmit={(event) => savePayment(event, payment.id)}
						>
							<div class="grid gap-4 sm:grid-cols-2">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.payee()}</span>
									<input
										class="w-full rounded border-zinc-300"
										bind:value={editPaymentPayee}
										required
									/>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.amount()}</span>
									<input
										class="w-full rounded border-zinc-300"
										bind:value={editPaymentAmount}
										inputmode="decimal"
										required
									/>
								</label>
							</div>
							<div class="grid gap-4 sm:grid-cols-3">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.due_date()}</span>
									<input
										class="w-full rounded border-zinc-300"
										type="date"
										bind:value={editPaymentDueDate}
										required
									/>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.status()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editPaymentStatus}>
										{#each paymentStatuses as option (option)}
											<option value={option}>{paymentStatusLabel(option)}</option>
										{/each}
									</select>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.account()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editPaymentAccountId}>
										<option value="">{m.not_available()}</option>
										{#each accounts as account (account.id)}
											<option value={account.id}>{account.name}</option>
										{/each}
									</select>
								</label>
							</div>
							<div class="grid gap-4 sm:grid-cols-2">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.category()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editPaymentCategoryId}>
										<option value="">{m.uncategorized()}</option>
										{#each categories as category (category.id)}
											<option value={category.id}>{category.name}</option>
										{/each}
									</select>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.notes()}</span>
									<input class="w-full rounded border-zinc-300" bind:value={editPaymentNote} />
								</label>
							</div>
							<div class="flex flex-wrap gap-2">
								<button
									class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
									type="submit">{m.save_planned_payment()}</button
								>
								<button
									class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700"
									type="button"
									onclick={cancelPaymentEdit}>{m.cancel_edit()}</button
								>
							</div>
						</form>
					{:else}
						<div class="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]">
							<div>
								<p class="font-medium text-zinc-950">{payment.payee}</p>
								<p class="mt-1 text-sm text-zinc-500">
									{formatDate(payment.dueDate)} / {paymentStatusLabel(payment.status)}
								</p>
							</div>
							<div class="text-left sm:text-right">
								<p class="font-semibold text-zinc-950">{centsToEuros(payment.amountCents)}</p>
								<div class="mt-2 flex flex-wrap gap-2 sm:justify-end">
									<button
										class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
										type="button"
										onclick={() => startPaymentEdit(payment)}>{m.edit_planned_payment()}</button
									>
									{#each paymentStatuses as option (option)}
										<button
											class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:bg-zinc-100"
											type="button"
											disabled={payment.status === option}
											onclick={() => updatePaymentStatus(payment, option)}
										>
											{paymentStatusLabel(option)}
										</button>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				{:else}
					<p class="p-5 text-sm text-zinc-600">{m.no_planned_payments()}</p>
				{/each}
			</div>
			<form class="grid gap-4 border-t border-zinc-200 p-5" onsubmit={createPayment}>
				<h3 class="text-sm font-semibold text-zinc-950">{m.new_planned_payment()}</h3>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.payee()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={paymentPayee} required />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.amount()}</span>
						<input
							class="w-full rounded border-zinc-300"
							bind:value={paymentAmount}
							inputmode="decimal"
							required
						/>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.due_date()}</span>
						<input
							class="w-full rounded border-zinc-300"
							type="date"
							bind:value={paymentDueDate}
							required
						/>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.account()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={paymentAccountId}>
							<option value="">{m.not_available()}</option>
							{#each accounts as account (account.id)}
								<option value={account.id}>{account.name}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.category()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={paymentCategoryId}>
							<option value="">{m.uncategorized()}</option>
							{#each categories as category (category.id)}
								<option value={category.id}>{category.name}</option>
							{/each}
						</select>
					</label>
				</div>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.notes()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={paymentNote} />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.status()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={paymentStatus}>
						{#each paymentStatuses as option (option)}
							<option value={option}>{paymentStatusLabel(option)}</option>
						{/each}
					</select>
				</label>
				<button
					class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					type="submit"
					disabled={isSavingPayment}
				>
					{m.create_planned_payment()}
				</button>
			</form>
		</section>

		<section class="rounded border border-zinc-200 bg-white shadow-sm">
			<div class="border-b border-zinc-200 p-5">
				<h2 class="text-lg font-semibold text-zinc-950">{m.planned_income_title()}</h2>
			</div>
			<div class="divide-y divide-zinc-100">
				{#each plannedIncome as income (income.id)}
					{#if editingIncomeId === income.id}
						<form
							class="grid gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-4"
							onsubmit={(event) => saveIncome(event, income.id)}
						>
							<div class="grid gap-4 sm:grid-cols-2">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.payer()}</span>
									<input
										class="w-full rounded border-zinc-300"
										bind:value={editIncomePayer}
										required
									/>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.amount()}</span>
									<input
										class="w-full rounded border-zinc-300"
										bind:value={editIncomeAmount}
										inputmode="decimal"
										required
									/>
								</label>
							</div>
							<div class="grid gap-4 sm:grid-cols-3">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.due_date()}</span>
									<input
										class="w-full rounded border-zinc-300"
										type="date"
										bind:value={editIncomeDueDate}
										required
									/>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.status()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editIncomeStatus}>
										{#each incomeStatuses as option (option)}
											<option value={option}>{incomeStatusLabel(option)}</option>
										{/each}
									</select>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.account()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editIncomeAccountId}>
										<option value="">{m.not_available()}</option>
										{#each accounts as account (account.id)}
											<option value={account.id}>{account.name}</option>
										{/each}
									</select>
								</label>
							</div>
							<div class="grid gap-4 sm:grid-cols-2">
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.category()}</span>
									<select class="w-full rounded border-zinc-300" bind:value={editIncomeCategoryId}>
										<option value="">{m.uncategorized()}</option>
										{#each categories as category (category.id)}
											<option value={category.id}>{category.name}</option>
										{/each}
									</select>
								</label>
								<label class="grid gap-1 text-sm font-medium text-zinc-700">
									<span>{m.notes()}</span>
									<input class="w-full rounded border-zinc-300" bind:value={editIncomeNote} />
								</label>
							</div>
							<div class="flex flex-wrap gap-2">
								<button
									class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
									type="submit">{m.save_planned_income()}</button
								>
								<button
									class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700"
									type="button"
									onclick={cancelIncomeEdit}>{m.cancel_edit()}</button
								>
							</div>
						</form>
					{:else}
						<div class="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]">
							<div>
								<p class="font-medium text-zinc-950">{income.payer}</p>
								<p class="mt-1 text-sm text-zinc-500">
									{formatDate(income.dueDate)} / {incomeStatusLabel(income.status)}
								</p>
							</div>
							<div class="text-left sm:text-right">
								<p class="font-semibold text-emerald-700">{centsToEuros(income.amountCents)}</p>
								<div class="mt-2 flex flex-wrap gap-2 sm:justify-end">
									<button
										class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
										type="button"
										onclick={() => startIncomeEdit(income)}>{m.edit_planned_income()}</button
									>
									{#each incomeStatuses as option (option)}
										<button
											class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:bg-zinc-100"
											type="button"
											disabled={income.status === option}
											onclick={() => updateIncomeStatus(income, option)}
										>
											{incomeStatusLabel(option)}
										</button>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				{:else}
					<p class="p-5 text-sm text-zinc-600">{m.no_planned_income()}</p>
				{/each}
			</div>
			<form class="grid gap-4 border-t border-zinc-200 p-5" onsubmit={createIncome}>
				<h3 class="text-sm font-semibold text-zinc-950">{m.new_planned_income()}</h3>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.payer()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={incomePayer} required />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.amount()}</span>
						<input
							class="w-full rounded border-zinc-300"
							bind:value={incomeAmount}
							inputmode="decimal"
							required
						/>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.due_date()}</span>
						<input
							class="w-full rounded border-zinc-300"
							type="date"
							bind:value={incomeDueDate}
							required
						/>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.account()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={incomeAccountId}>
							<option value="">{m.not_available()}</option>
							{#each accounts as account (account.id)}
								<option value={account.id}>{account.name}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.category()}</span>
						<select class="w-full rounded border-zinc-300" bind:value={incomeCategoryId}>
							<option value="">{m.uncategorized()}</option>
							{#each categories as category (category.id)}
								<option value={category.id}>{category.name}</option>
							{/each}
						</select>
					</label>
				</div>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.notes()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={incomeNote} />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.status()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={incomeStatus}>
						{#each incomeStatuses as option (option)}
							<option value={option}>{incomeStatusLabel(option)}</option>
						{/each}
					</select>
				</label>
				<button
					class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					type="submit"
					disabled={isSavingIncome}
				>
					{m.create_planned_income()}
				</button>
			</form>
		</section>
	</section>

	<section class="grid gap-6 xl:grid-cols-3">
		<section class="rounded border border-zinc-200 bg-white shadow-sm xl:col-span-2">
			<div class="border-b border-zinc-200 p-5">
				<h2 class="text-lg font-semibold text-zinc-950">{m.liabilities_title()}</h2>
			</div>
			<div class="divide-y divide-zinc-100">
				{#each liabilities as liability (liability.id)}
					<div class="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
						<div>
							<p class="font-medium text-zinc-950">{liability.name}</p>
							<p class="mt-1 text-sm text-zinc-500">
								{formatDate(liability.asOfDate)} / {liabilityStatusLabel(liability.status)}
							</p>
							<p class="mt-1 text-xs text-zinc-500">
								{liability.accountName ?? m.not_available()}
								{#if liability.note}
									/ {liability.note}
								{/if}
							</p>
						</div>
						<div class="text-left lg:text-right">
							<p class="font-semibold text-red-700">{centsToEuros(liability.amountCents)}</p>
							<div class="mt-2 flex flex-wrap gap-2 lg:justify-end">
								{#each liabilityStatuses as option (option)}
									<button
										class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:bg-zinc-100"
										type="button"
										disabled={liability.status === option}
										onclick={() => updateLiabilityStatus(liability, option)}
									>
										{liabilityStatusLabel(option)}
									</button>
								{/each}
								<button
									class="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700"
									type="button"
									onclick={() => deleteLiability(liability)}
								>
									{m.delete_liability()}
								</button>
							</div>
						</div>
					</div>
				{:else}
					<p class="p-5 text-sm text-zinc-600">{m.no_liabilities()}</p>
				{/each}
			</div>
		</section>

		<form class="rounded border border-zinc-200 bg-white p-5 shadow-sm" onsubmit={createLiability}>
			<h2 class="text-lg font-semibold text-zinc-950">{m.new_liability()}</h2>
			<div class="mt-5 grid gap-4">
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.liability_name()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={liabilityName} required />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.amount()}</span>
						<input
							class="w-full rounded border-zinc-300"
							bind:value={liabilityAmount}
							inputmode="decimal"
							required
						/>
					</label>
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.as_of_date()}</span>
						<input
							class="w-full rounded border-zinc-300"
							type="date"
							bind:value={liabilityAsOfDate}
							required
						/>
					</label>
				</div>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.account()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={liabilityAccountId}>
						<option value="">{m.not_available()}</option>
						{#each accounts as account (account.id)}
							<option value={account.id}>{account.name}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.notes()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={liabilityNote} />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.status()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={liabilityStatus}>
						{#each liabilityStatuses as option (option)}
							<option value={option}>{liabilityStatusLabel(option)}</option>
						{/each}
					</select>
				</label>
				<button
					class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					type="submit"
					disabled={isSavingLiability}
				>
					{m.create_liability()}
				</button>
			</div>
		</form>
	</section>

	<section class="grid gap-6 xl:grid-cols-3">
		<section class="rounded border border-zinc-200 bg-white shadow-sm xl:col-span-2">
			<div class="flex items-center justify-between gap-3 border-b border-zinc-200 p-5">
				<h2 class="text-lg font-semibold text-zinc-950">{m.recurring_title()}</h2>
				<button
					class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700"
					type="button"
					disabled={isUpdatingRecurring}
					onclick={refreshRecurringSuggestions}>{m.refresh_suggestions()}</button
				>
			</div>
			{#if selectedRecurring}
				<form
					class="grid gap-4 border-b border-zinc-200 bg-amber-50 p-5"
					onsubmit={confirmRecurring}
				>
					<div>
						<h3 class="font-semibold text-zinc-950">
							{m.review_recurring({ payee: selectedRecurring.payee })}
						</h3>
						<p class="mt-1 text-sm text-zinc-600">
							Confidence {selectedRecurring.confidence}% · interval {selectedRecurring
								.confidenceFactors.interval}/40 · amount {selectedRecurring.confidenceFactors
								.amount}/30 · history {selectedRecurring.confidenceFactors.history}/20 · recency {selectedRecurring
								.confidenceFactors.recency}/10
						</p>
					</div>
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
						<label class="grid gap-1 text-sm"
							><span>{m.direction()}</span><select bind:value={recurringDirection}
								><option value="outgoing">{m.outgoing()}</option><option value="incoming"
									>{m.incoming()}</option
								></select
							></label
						>
						<label class="grid gap-1 text-sm"
							><span>{m.category()}</span><select bind:value={recurringCategoryId} required
								><option value="" disabled>{m.select_category()}</option
								>{#each categories.filter( (category) => (recurringDirection === 'incoming' ? category.type === 'income' : category.type !== 'income' && category.type !== 'transfer') ) as category (category.id)}<option
										value={category.id}>{category.name}</option
									>{/each}</select
							></label
						>
						<label class="grid gap-1 text-sm"
							><span>{m.cadence()}</span><select bind:value={recurringCadence}
								>{#each cadences as cadence (cadence)}<option value={cadence}
										>{cadenceLabel(cadence)}</option
									>{/each}</select
							></label
						>
						<label class="grid gap-1 text-sm"
							><span>{m.amount()}</span><input bind:value={recurringAmount} required /></label
						>
						<label class="grid gap-1 text-sm sm:col-span-2 lg:col-span-5"
							><span>{m.label()}</span><input bind:value={recurringLabel} /></label
						>
						<label class="grid gap-1 text-sm"
							><span>{m.next_date()}</span><input
								type="date"
								bind:value={recurringNextDate}
								required
							/></label
						>
					</div>
					<div class="rounded border border-amber-200 bg-white p-3">
						<p class="text-sm font-medium text-zinc-700">{m.supporting_transactions()}</p>
						{#each selectedRecurring.evidence as item (item.transactionId)}<div
								class="mt-2 flex justify-between gap-3 text-sm"
							>
								<span>{formatDate(item.bookingDate)} · {item.payee ?? selectedRecurring.payee}</span
								><span>{centsToEuros(item.amountCents)}</span>
							</div>{/each}
					</div>
					<div class="flex gap-2">
						<button
							class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
							type="submit"
							disabled={isUpdatingRecurring || !recurringCategoryId}>{m.confirm_recurring()}</button
						><button
							class="rounded border border-zinc-300 px-4 py-2 text-sm"
							type="button"
							onclick={() => (selectedRecurring = null)}>{m.cancel()}</button
						>
					</div>
				</form>
			{/if}
			<div class="divide-y divide-zinc-100">
				{#each recurringGroups as group (group.id)}
					<div class="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
						<div>
							<p class="font-medium text-zinc-950">{group.label || group.payee}</p>
							{#if group.label}<p class="text-sm text-zinc-500">{group.payee}</p>{/if}
							<p class="mt-1 text-sm text-zinc-500">
								{cadenceLabel(group.cadence)} / {formatDate(group.nextDate)} / {group.confidence}%
							</p>
							<p class="mt-1 text-xs text-zinc-500">
								{group.accountName ?? m.not_available()} / {group.categoryName ?? m.uncategorized()}
							</p>
						</div>
						<div class="text-left lg:text-right">
							<p class="font-semibold text-zinc-950">{centsToEuros(group.expectedAmountCents)}</p>
							<div class="mt-2 flex flex-wrap gap-2 lg:justify-end">
								<button
									class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:bg-zinc-100"
									type="button"
									disabled={group.status === 'confirmed' || isUpdatingRecurring}
									onclick={() => reviewRecurring(group)}
								>
									{m.confirm_recurring()}
								</button>
								<button
									class="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:bg-zinc-100"
									type="button"
									disabled={group.status === 'ignored' || isUpdatingRecurring}
									onclick={() => updateRecurringStatus(group, 'ignored')}
								>
									{m.ignore_recurring()}
								</button>
							</div>
						</div>
					</div>
				{:else}
					<p class="p-5 text-sm text-zinc-600">{m.no_recurring_groups()}</p>
				{/each}
			</div>
		</section>

		<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.current_month_outlook()}</h2>
			<div class="mt-5 grid gap-4">
				<div>
					<h3 class="text-sm font-semibold text-zinc-950">{m.upcoming_payments()}</h3>
					<ul class="mt-2 grid gap-2 text-sm text-zinc-600">
						{#each upcomingPayments as payment (payment.id)}
							<li class="flex justify-between gap-3">
								<span>{formatDate(payment.dueDate)} {payment.payee}</span>
								<span class="font-medium text-zinc-950">{centsToEuros(payment.amountCents)}</span>
							</li>
						{:else}
							<li>{m.no_upcoming_payments()}</li>
						{/each}
					</ul>
				</div>
				<div>
					<h3 class="text-sm font-semibold text-zinc-950">{m.upcoming_income()}</h3>
					<ul class="mt-2 grid gap-2 text-sm text-zinc-600">
						{#each upcomingIncome as income (income.id)}
							<li class="flex justify-between gap-3">
								<span>{formatDate(income.dueDate)} {income.payer}</span>
								<span class="font-medium text-emerald-700">{centsToEuros(income.amountCents)}</span>
							</li>
						{:else}
							<li>{m.no_upcoming_income()}</li>
						{/each}
					</ul>
				</div>
				<div class="rounded border border-zinc-200 bg-zinc-50 p-4 text-sm">
					<p class="font-medium text-zinc-950">{m.balance_before_salary()}</p>
					<form class="mt-3 grid gap-2" onsubmit={applyManualNextSalaryDate}>
						<label class="grid gap-1 text-sm font-medium text-zinc-700">
							<span>{m.manual_next_salary_date()}</span>
							<input
								class="w-full rounded border-zinc-300"
								type="date"
								bind:value={manualNextSalaryDate}
							/>
						</label>
						<button
							class="rounded border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700"
							type="submit"
						>
							{m.apply_projection_date()}
						</button>
					</form>
					<p class="mt-1 text-zinc-600">
						{projection?.manualNextSalaryDate
							? `${m.manual_salary_date()}: ${formatDate(projection.manualNextSalaryDate)}`
							: projection?.nextIncome
								? `${m.next_income()}: ${projection.nextIncome.payer} ${formatDate(projection.nextIncome.dueDate)}`
								: m.no_upcoming_income()}
					</p>
					<p class="mt-2 text-lg font-semibold text-zinc-950">
						{projection ? centsToEuros(projection.projectedBalanceCents) : m.not_available()}
					</p>
				</div>
			</div>
		</section>
	</section>
</main>
