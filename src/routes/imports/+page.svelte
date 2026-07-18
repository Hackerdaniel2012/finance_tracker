<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import ButtonSpinner from '$lib/components/ButtonSpinner.svelte';
	import ErrorAlert from '$lib/components/ErrorAlert.svelte';
	import InlineSuccess from '$lib/components/InlineSuccess.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Picker from '$lib/components/Picker.svelte';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { onMount } from 'svelte';

	type BankId = 'n26' | 'trade_republic' | 'dkb_girocard' | 'dkb_creditcard';
	type BalanceMode = 'reported' | 'complete_history' | 'continue_from_snapshot';
	type PreviewStatus = 'needs_configuration' | 'ready' | 'no_new_transactions';
	interface Account {
		id: string;
		name: string;
		institution: string | null;
		balanceInitialized: boolean;
	}
	interface BankScheme {
		id: BankId;
		label: string;
		status: 'enabled' | 'disabled';
	}
	interface TransactionRow {
		bookingDate: string;
		amountCents: number;
		payee?: string;
		description?: string;
		dedupeKey: string;
	}
	interface PreviewAccount {
		sourceAccountKey: string | null;
		sourceAccountLabel: string;
		stableSourceKey: boolean;
		suggestedAccountId: string | null;
		assignment: {
			sourceAccountKey: string | null;
			targetAccountId?: string;
			balanceMode: BalanceMode;
		} | null;
		suggestedName: string;
		rowCount: number;
		startDate: string | null;
		endDate: string | null;
		sampleRows: TransactionRow[];
		targetAccountName: string | null;
		targetBalanceInitialized: boolean;
		importableRowCount: number | null;
		duplicateRows: unknown[];
		calculatedBalanceCents: number | null;
		differenceCents: number | null;
		balanceMatches: boolean;
	}
	interface ImportPreview {
		adapterId: BankId;
		fileHash: string;
		configurationHash: string | null;
		status: PreviewStatus;
		summary: {
			parsedRows: number;
			skippedRows: number;
			errorCount: number;
			accountCount: number;
			newRowCount: number | null;
			duplicateCount: number | null;
			startDate: string | null;
			endDate: string | null;
		};
		accounts: PreviewAccount[];
		errors: Array<{ rowNumber: number; message: string }>;
	}
	interface AssignmentForm {
		sourceAccountKey: string | null;
		targetKind: 'existing' | 'new';
		targetAccountId: string;
		name: string;
		institution: string;
		balanceMode: BalanceMode;
		reportedBalance: string;
		autoResolved: boolean;
	}
	interface ImportReport {
		runId: string;
		importedCount: number;
		duplicateCount: number;
		errorCount: number;
		unknownCount: number;
		accounts: Array<{ accountId: string; accountName: string; createdAccount: boolean }>;
	}
	interface ImportRun {
		id: string;
		adapterId: BankId;
		startDate: string | null;
		endDate: string | null;
		importedCount: number;
		duplicateCount: number;
		accounts: Array<{ accountId: string; accountName: string; importedCount: number }>;
		canDelete: boolean;
		createdAt: string;
	}

	let accounts = $state<Account[]>([]);
	let schemes = $state<BankScheme[]>([]);
	let imports = $state<ImportRun[]>([]);
	let selectedAdapterId = $state<BankId | ''>('');
	let selectedFile = $state<File | null>(null);
	let preview = $state<ImportPreview | null>(null);
	let assignments = $state<AssignmentForm[]>([]);
	let report = $state<ImportReport | null>(null);
	let isLoadingSetup = $state(true);
	let isLoadingHistory = $state(true);
	let isPreviewing = $state(false);
	let isValidating = $state(false);
	let isConfirming = $state(false);
	let deletingImportId = $state<string | null>(null);
	let setupError = $state<string | null>(null);
	let previewError = $state<string | null>(null);
	let historyError = $state<string | null>(null);
	let importSuccess = $state<string | null>(null);
	let historySuccess = $state<string | null>(null);

	const canDiscover = $derived(selectedAdapterId !== '' && selectedFile !== null && !isPreviewing);
	const canValidate = $derived(
		preview !== null &&
			preview.status === 'needs_configuration' &&
			selectedFile !== null &&
			assignments.length === preview.accounts.length &&
			assignments.every(assignmentIsComplete) &&
			!isValidating
	);
	const canConfirm = $derived(preview?.status === 'ready' && !isConfirming);

	onMount(() => void Promise.all([loadSetup(), loadHistory()]));

	async function loadSetup() {
		isLoadingSetup = true;
		setupError = null;
		try {
			const [accountPayload, bankPayload] = await Promise.all([
				fetchJson<{ accounts: Account[] }>('/api/accounts'),
				fetchJson<{ banks: BankScheme[] }>('/api/banks')
			]);
			accounts = accountPayload.accounts;
			schemes = bankPayload.banks.filter((scheme) => scheme.status === 'enabled');
			selectedAdapterId = selectedAdapterId || schemes[0]?.id || '';
		} catch {
			setupError = m.import_setup_load_error();
		} finally {
			isLoadingSetup = false;
		}
	}

	async function loadHistory() {
		isLoadingHistory = true;
		historyError = null;
		try {
			imports = (await fetchJson<{ imports: ImportRun[] }>('/api/imports')).imports;
		} catch {
			historyError = m.import_history_load_error();
		} finally {
			isLoadingHistory = false;
		}
	}

	function handleFileChange(event: Event) {
		selectedFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
		resetPreview();
	}

	function resetPreview() {
		preview = null;
		assignments = [];
		report = null;
		previewError = null;
	}

	function invalidateConfiguration() {
		if (!preview) return;
		preview = {
			...preview,
			status: 'needs_configuration',
			configurationHash: null,
			summary: { ...preview.summary, newRowCount: null, duplicateCount: null }
		};
	}

	function normalizeAssignmentTarget(assignment: AssignmentForm) {
		// Picker updates its bindable value before the parent binding propagates.
		// Normalize on the next microtask so this reads the newly selected target.
		queueMicrotask(() => {
			if (
				assignment.targetKind === 'existing' &&
				accountIsInitialized(assignment.targetAccountId)
			) {
				assignment.balanceMode = 'continue_from_snapshot';
			} else if (assignment.balanceMode === 'continue_from_snapshot') {
				assignment.balanceMode = 'reported';
			}
			assignment.autoResolved = false;
			invalidateConfiguration();
		});
	}

	async function discoverAccounts(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedFile) return;
		isPreviewing = true;
		previewError = null;
		report = null;
		try {
			preview = (
				await fetchJson<{ preview: ImportPreview }>('/api/imports/preview', {
					method: 'POST',
					body: buildFormData()
				})
			).preview;
			assignments = preview.accounts.map((group) => initialAssignment(group));
		} catch {
			previewError = m.import_preview_error();
		} finally {
			isPreviewing = false;
		}
	}

	async function validateConfiguration() {
		if (!selectedFile || !preview) return;
		isValidating = true;
		previewError = null;
		try {
			const form = buildFormData();
			form.set('assignments', JSON.stringify(serializedAssignments()));
			preview = (
				await fetchJson<{ preview: ImportPreview }>('/api/imports/preview', {
					method: 'POST',
					body: form
				})
			).preview;
		} catch {
			previewError = m.import_configuration_error();
		} finally {
			isValidating = false;
		}
	}

	async function confirmImport() {
		if (!selectedFile || preview?.status !== 'ready') return;
		isConfirming = true;
		previewError = null;
		try {
			const form = buildFormData();
			form.set('expectedHash', preview.fileHash);
			form.set('expectedConfigurationHash', preview.configurationHash ?? '');
			form.set('assignments', JSON.stringify(serializedAssignments()));
			report = (
				await fetchJson<{ report: ImportReport }>('/api/imports/confirm', {
					method: 'POST',
					body: form
				})
			).report;
			await Promise.all([loadHistory(), loadSetup()]);
			importSuccess = m.import_confirmed_success();
			preview = null;
			assignments = [];
		} catch {
			previewError = m.import_confirm_error();
		} finally {
			isConfirming = false;
		}
	}

	async function deleteImport(run: ImportRun) {
		deletingImportId = run.id;
		historyError = null;
		historySuccess = null;
		try {
			await fetchJson(`/api/imports/${run.id}`, { method: 'DELETE' });
			await Promise.all([loadHistory(), loadSetup()]);
			historySuccess = m.import_deleted_success();
		} catch {
			historyError = m.import_delete_error();
		} finally {
			deletingImportId = null;
		}
	}

	function initialAssignment(group: PreviewAccount): AssignmentForm {
		if (group.assignment?.targetAccountId) {
			return {
				sourceAccountKey: group.sourceAccountKey,
				targetKind: 'existing',
				targetAccountId: group.assignment.targetAccountId,
				name: group.suggestedName,
				institution: schemeLabel(preview!.adapterId),
				balanceMode: group.assignment.balanceMode,
				reportedBalance: '',
				autoResolved: group.assignment.balanceMode === 'continue_from_snapshot'
			};
		}
		const suggested = accounts.find((account) => account.id === group.suggestedAccountId);
		return {
			sourceAccountKey: group.sourceAccountKey,
			targetKind: suggested ? 'existing' : 'new',
			targetAccountId: suggested?.id ?? accounts[0]?.id ?? '',
			name: group.suggestedName,
			institution: schemeLabel(preview!.adapterId),
			balanceMode: suggested?.balanceInitialized === true ? 'continue_from_snapshot' : 'reported',
			reportedBalance: '',
			autoResolved: false
		};
	}

	function assignmentIsComplete(assignment: AssignmentForm): boolean {
		if (assignment.targetKind === 'existing' && !assignment.targetAccountId) return false;
		if (assignment.targetKind === 'new' && !assignment.name.trim()) return false;
		return (
			assignment.balanceMode === 'complete_history' ||
			assignment.balanceMode === 'continue_from_snapshot' ||
			eurosToCents(assignment.reportedBalance) !== null
		);
	}

	function serializedAssignments() {
		return assignments.map((assignment) => ({
			sourceAccountKey: assignment.sourceAccountKey,
			...(assignment.targetKind === 'existing'
				? { targetAccountId: assignment.targetAccountId }
				: {
						newAccount: {
							name: assignment.name,
							institution: assignment.institution.trim() || null
						}
					}),
			balanceMode: assignment.balanceMode,
			...(assignment.balanceMode === 'reported'
				? { reportedBalanceCents: eurosToCents(assignment.reportedBalance) }
				: {})
		}));
	}

	function buildFormData() {
		if (!selectedFile) throw new Error('file required');
		const form = new FormData();
		form.set('adapterId', selectedAdapterId);
		form.set('file', selectedFile);
		return form;
	}

	function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		return fetchJsonWithRetry<T>(url, init);
	}
	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR' });
	}
	function eurosToCents(value: string): number | null {
		const normalized = value.trim().replace(',', '.');
		if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
		return Math.round(Number(normalized) * 100);
	}
	function formatDate(value: string | null): string {
		return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : m.not_available();
	}
	function formatDateTime(value: string): string {
		return new Date(value).toLocaleString();
	}
	function schemeLabel(adapterId: BankId): string {
		return schemes.find((scheme) => scheme.id === adapterId)?.label ?? adapterId;
	}
	function accountIsInitialized(accountId: string): boolean {
		return accounts.find((account) => account.id === accountId)?.balanceInitialized ?? false;
	}
</script>

<svelte:head>
	<title>{m.nav_imports()} / {m.app_title()}</title>
	<meta name="description" content={m.imports_subtitle()} />
</svelte:head>

<main
	class="mx-auto grid max-w-[90rem] gap-6 px-6 pb-[50px] pt-6 lg:grid-cols-[minmax(0,24rem)_1fr] lg:pt-8"
>
	<section class="rounded-ui border border-zinc-200 bg-white p-5" aria-busy={isLoadingSetup}>
		<h2 class="text-lg font-semibold text-zinc-950">{m.import_upload_title()}</h2>
		{#if setupError}<ErrorAlert
				class="mt-4"
				message={setupError}
				retry={loadSetup}
				retryLabel={m.retry()}
			/>{/if}
		{#if isLoadingSetup}
			<div class="mt-5 grid gap-4">
				{#each Array(3) as _}<Skeleton class="h-11 w-full" rounded="rounded-ui" />{/each}
			</div>
		{:else}
			<form class="mt-5 grid gap-4" onsubmit={discoverAccounts}>
				<div class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.csv_scheme()}</span>
					<Picker
						ariaLabel={m.csv_scheme()}
						placeholder={m.required()}
						options={schemes.map((scheme) => ({ value: scheme.id, label: scheme.label }))}
						bind:value={selectedAdapterId}
						onchange={resetPreview}
					/>
				</div>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.csv_file()}</span>
					<input
						class="w-full rounded border border-zinc-300 text-sm file:mr-3 file:border-0 file:bg-zinc-100 file:px-3 file:py-2"
						type="file"
						accept=".csv,text/csv"
						onchange={handleFileChange}
						required
					/>
				</label>
				<button
					class="flex h-11 items-center justify-center gap-2 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
					type="submit"
					disabled={!canDiscover}
					aria-busy={isPreviewing}
				>
					{#if isPreviewing}<ButtonSpinner />{/if}{m.detect_csv_accounts()}
				</button>
			</form>
		{/if}
	</section>

	<section class="grid gap-6">
		<section class="rounded-ui border border-zinc-200 bg-white p-5">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-lg font-semibold text-zinc-950">{m.import_preview_title()}</h2>
				{#if preview}
					<div class="flex gap-2">
						{#if preview.status === 'needs_configuration'}
							<button
								class="flex h-11 items-center gap-2 rounded border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
								type="button"
								disabled={!canValidate}
								onclick={validateConfiguration}
								>{#if isValidating}<ButtonSpinner />{/if}{m.validate_account_setup()}</button
							>
						{/if}
						<button
							class="flex h-11 items-center gap-2 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
							type="button"
							disabled={!canConfirm}
							onclick={confirmImport}
							>{#if isConfirming}<ButtonSpinner />{/if}{m.confirm_import()}</button
						>
					</div>
				{/if}
			</div>
			{#if previewError}<ErrorAlert class="mt-4" message={previewError} />{/if}
			{#if importSuccess}<div class="mt-4">
					<InlineSuccess message={importSuccess} onDismiss={() => (importSuccess = null)} />
				</div>{/if}
			{#if isPreviewing}
				<div class="mt-5 grid gap-4">
					{#each Array(2) as _}<Skeleton class="h-72 w-full" rounded="rounded-ui" />{/each}
				</div>
			{:else if preview}
				{#if preview.status === 'no_new_transactions'}
					<div class="mt-4 rounded-ui border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
						<p class="font-semibold">{m.no_new_transactions_to_import()}</p>
						<p class="mt-1">{m.no_new_transactions_description()}</p>
					</div>
				{/if}
				<div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.detected_accounts()}</p>
						<p class="mt-1 text-2xl font-semibold">{preview.summary.accountCount}</p>
					</article>
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.new_transactions()}</p>
						<p class="mt-1 text-2xl font-semibold">
							{preview.summary.newRowCount ?? m.not_available()}
						</p>
					</article>
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.already_imported()}</p>
						<p class="mt-1 text-2xl font-semibold">
							{preview.summary.duplicateCount ?? m.not_available()}
						</p>
					</article>
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.parsed_rows()}</p>
						<p class="mt-1 text-2xl font-semibold">{preview.summary.parsedRows}</p>
					</article>
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.date_range()}</p>
						<p class="mt-1 text-sm font-semibold">
							{formatDate(preview.summary.startDate)} – {formatDate(preview.summary.endDate)}
						</p>
					</article>
				</div>

				<div class="mt-5 grid gap-5">
					{#each preview.accounts as group, index (`${group.sourceAccountKey ?? 'single'}`)}
						{@const assignment = assignments[index]}
						<article class="rounded-ui border border-zinc-200 p-5">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<div>
									<h3 class="font-semibold text-zinc-950">{group.sourceAccountLabel}</h3>
									<p class="mt-1 text-sm text-zinc-500">
										{m.account_group_summary({
											rows: group.rowCount,
											from: formatDate(group.startDate),
											to: formatDate(group.endDate)
										})}
									</p>
								</div>
								{#if assignment?.autoResolved}<span
										class="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
										>{m.automatically_mapped()}</span
									>{/if}
							</div>
							{#if group.importableRowCount !== null}
								<p class="mt-3 text-sm font-medium text-zinc-700">
									{m.account_update_summary({
										newRows: group.importableRowCount,
										duplicates: group.duplicateRows.length
									})}
								</p>
							{/if}
							{#if assignment}
								<details
									class="mt-4 rounded-ui border border-zinc-200 p-4"
									open={!assignment.autoResolved}
								>
									<summary class="cursor-pointer text-sm font-medium text-zinc-800">
										{assignment.autoResolved
											? m.review_account_mapping()
											: m.configure_account_mapping()}
									</summary>
									<div class="mt-4 grid gap-4 md:grid-cols-2">
										<div class="grid gap-1 text-sm font-medium text-zinc-700">
											<span>{m.target_account()}</span><Picker
												ariaLabel={m.target_account()}
												placeholder={m.required()}
												options={[
													{ value: 'existing', label: m.use_existing_account() },
													{ value: 'new', label: m.create_new_account() }
												]}
												bind:value={assignment.targetKind}
												onchange={() => normalizeAssignmentTarget(assignment)}
											/>
										</div>
										{#if assignment.targetKind === 'existing'}
											<div class="grid gap-1 text-sm font-medium text-zinc-700">
												<span>{m.account()}</span><Picker
													ariaLabel={m.account()}
													placeholder={m.required()}
													options={accounts.map((account) => ({
														value: account.id,
														label: account.name
													}))}
													bind:value={assignment.targetAccountId}
													onchange={() => normalizeAssignmentTarget(assignment)}
												/>
											</div>
										{:else}
											<label class="grid gap-1 text-sm font-medium text-zinc-700"
												><span>{m.account_name()}</span><input
													class="h-11 rounded border border-zinc-300 px-3"
													bind:value={assignment.name}
													oninput={invalidateConfiguration}
													required
												/></label
											>
											<label class="grid gap-1 text-sm font-medium text-zinc-700"
												><span>{m.institution()}</span><input
													class="h-11 rounded border border-zinc-300 px-3"
													bind:value={assignment.institution}
													oninput={invalidateConfiguration}
												/></label
											>
										{/if}
										{#if assignment.balanceMode === 'continue_from_snapshot'}
											<div class="grid gap-1 text-sm text-zinc-700">
												<span class="font-medium">{m.balance_basis()}</span>
												<p
													class="flex h-11 items-center rounded border border-zinc-200 bg-zinc-50 px-3"
												>
													{m.continue_from_saved_balance()}
												</p>
											</div>
										{:else}
											<div class="grid gap-1 text-sm font-medium text-zinc-700">
												<span>{m.balance_basis()}</span><Picker
													ariaLabel={m.balance_basis()}
													placeholder={m.required()}
													options={[
														{ value: 'reported', label: m.enter_current_balance() },
														{ value: 'complete_history', label: m.complete_history_from_zero() }
													]}
													bind:value={assignment.balanceMode}
													onchange={invalidateConfiguration}
												/>
											</div>
										{/if}
										{#if assignment.balanceMode === 'reported'}
											<label class="grid gap-1 text-sm font-medium text-zinc-700"
												><span>{m.entered_balance()}</span><input
													class="h-11 rounded border border-zinc-300 px-3"
													inputmode="decimal"
													placeholder="0,00"
													bind:value={assignment.reportedBalance}
													oninput={invalidateConfiguration}
													required
												/></label
											>
										{:else if assignment.balanceMode === 'complete_history'}<p
												class="self-end pb-2 text-sm leading-6 text-zinc-600"
											>
												{m.complete_history_confirmation()}
											</p>{/if}
									</div>
								</details>
								{#if preview.status !== 'needs_configuration'}
									<div class="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">
										{m.account_preview_ready()}
										{#if group.calculatedBalanceCents !== null}{m.calculated_balance()}: {centsToEuros(
												group.calculatedBalanceCents
											)}.{/if}
										{m.new_transactions()}: {group.importableRowCount ?? 0}.
									</div>
								{/if}
							{/if}
							{#if group.sampleRows.length > 0}
								<div class="mt-4 overflow-x-auto">
									<table class="min-w-full text-left text-sm">
										<thead class="text-xs uppercase text-zinc-500"
											><tr
												><th class="px-2 py-2">{m.date()}</th><th class="px-2 py-2">{m.payee()}</th
												><th class="px-2 py-2 text-right">{m.amount()}</th></tr
											></thead
										><tbody class="divide-y divide-zinc-100"
											>{#each group.sampleRows as row (row.dedupeKey)}<tr
													><td class="px-2 py-2">{formatDate(row.bookingDate)}</td><td
														class="px-2 py-2"
														>{row.payee || row.description || m.not_available()}</td
													><td class="px-2 py-2 text-right font-medium"
														>{centsToEuros(row.amountCents)}</td
													></tr
												>{/each}</tbody
										>
									</table>
								</div>
							{/if}
						</article>
					{/each}
				</div>
				{#if preview.errors.length > 0}<div
						class="mt-5 rounded border border-amber-200 bg-amber-50 p-4"
					>
						<h3 class="font-semibold text-amber-950">{m.parse_errors()}</h3>
						<ul class="mt-2 text-sm text-amber-900">
							{#each preview.errors as error}<li>{error.rowNumber}: {error.message}</li>{/each}
						</ul>
					</div>{/if}
			{:else}<p class="mt-5 text-sm leading-6 text-zinc-600">{m.no_import_preview()}</p>{/if}
		</section>

		{#if report}<section class="rounded border border-emerald-200 bg-emerald-50 p-5">
				<h2 class="text-lg font-semibold text-emerald-950">{m.import_report_title()}</h2>
				<p class="mt-3 text-sm text-emerald-900">
					{m.imported_rows()}: {report.importedCount} · {m.duplicate_rows()}: {report.duplicateCount}
					· {m.unknown_transactions()}: {report.unknownCount}
				</p>
				<ul class="mt-3 text-sm text-emerald-900">
					{#each report.accounts as account}<li>
							{account.accountName}{account.createdAccount ? ` (${m.account_created()})` : ''}
						</li>{/each}
				</ul>
			</section>{/if}

		<section class="rounded-ui border border-zinc-200 bg-white p-5" aria-busy={isLoadingHistory}>
			<h2 class="text-lg font-semibold text-zinc-950">{m.import_history_title()}</h2>
			{#if historyError}<ErrorAlert
					class="mt-4"
					message={historyError}
					retry={loadHistory}
					retryLabel={m.retry()}
				/>{/if}
			{#if historySuccess}<div class="mt-4">
					<InlineSuccess message={historySuccess} onDismiss={() => (historySuccess = null)} />
				</div>{/if}
			<div class="mt-5 divide-y divide-zinc-200">
				{#if isLoadingHistory}{#each Array(3) as _}<div class="py-4">
							<Skeleton class="h-14 w-full" />
						</div>{/each}
				{:else if imports.length === 0}<p class="py-4 text-sm text-zinc-500">
						{m.no_import_batches()}
					</p>
				{:else}{#each imports as run (run.id)}<article
							class="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
						>
							<div>
								<h3 class="font-semibold text-zinc-950">
									{schemeLabel(run.adapterId)} · {run.accounts
										.map((account) => account.accountName)
										.join(', ')}
								</h3>
								<p class="mt-1 text-sm text-zinc-500">
									{formatDate(run.startDate)} – {formatDate(run.endDate)} · {formatDateTime(
										run.createdAt
									)}
								</p>
								<p class="mt-1 text-sm text-zinc-700">
									{m.imported_rows()}: {run.importedCount} · {m.duplicate_rows()}: {run.duplicateCount}
								</p>
							</div>
							<button
								class="flex h-11 items-center gap-2 rounded border border-red-200 px-3 text-sm font-medium text-red-700 disabled:opacity-50"
								type="button"
								disabled={deletingImportId === run.id || !run.canDelete}
								title={!run.canDelete ? m.delete_newer_imports_first() : undefined}
								onclick={() => deleteImport(run)}
								>{#if deletingImportId === run.id}<ButtonSpinner
									/>{/if}{m.delete_import_batch()}</button
							>
						</article>{/each}{/if}
			</div>
		</section>
	</section>
</main>
