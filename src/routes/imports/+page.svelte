<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { onMount } from 'svelte';
	import Picker from '$lib/components/Picker.svelte';

	type BankId = 'n26' | 'trade_republic' | 'dkb_girocard' | 'dkb_creditcard';

	interface Account {
		id: string;
		name: string;
	}

	interface BankScheme {
		id: BankId;
		label: string;
		status: 'enabled' | 'disabled';
	}

	interface NormalizedTransaction {
		bookingDate: string;
		amountCents: number;
		payee: string | null;
		description: string | null;
		dedupeKey: string;
	}

	interface ImportPreview {
		accountId: string;
		adapterId: BankId;
		fileHash: string;
		summary: {
			parsedRows: number;
			skippedRows: number;
			errorCount: number;
			duplicateEstimate: number;
			startDate: string | null;
			endDate: string | null;
		};
		sampleRows: NormalizedTransaction[];
		errors: Array<{ rowNumber: number; code: string; message: string }>;
	}

	interface ImportReport {
		batchId: string;
		accountId: string;
		adapterId: BankId;
		fileHash: string;
		startDate: string | null;
		endDate: string | null;
		rowCount: number;
		importedCount: number;
		duplicateCount: number;
		errorCount: number;
		unknownCount: number;
	}

	interface ImportBatch {
		id: string;
		accountId: string;
		accountName: string;
		adapterId: BankId;
		startDate: string | null;
		endDate: string | null;
		rowCount: number;
		importedCount: number;
		duplicateCount: number;
		errorCount: number;
		createdAt: string;
	}

	let accounts = $state<Account[]>([]);
	let schemes = $state<BankScheme[]>([]);
	let imports = $state<ImportBatch[]>([]);
	let selectedAccountId = $state('');
	let selectedAdapterId = $state<BankId | ''>('');
	let selectedFile = $state<File | null>(null);
	let preview = $state<ImportPreview | null>(null);
	let report = $state<ImportReport | null>(null);
	let status = $state(m.import_status_loading());
	let error = $state<string | null>(null);
	let isPreviewing = $state(false);
	let isConfirming = $state(false);
	let deletingImportId = $state<string | null>(null);

	const canPreview = $derived(
		selectedAccountId !== '' && selectedAdapterId !== '' && selectedFile !== null && !isPreviewing
	);
	const canConfirm = $derived(
		preview !== null &&
			selectedFile !== null &&
			!isConfirming &&
			preview.accountId === selectedAccountId && preview.adapterId === selectedAdapterId
	);

	onMount(() => {
		void loadImportState();
	});

	async function loadImportState() {
		status = m.import_status_loading();
		error = null;

		try {
			const [accountPayload, bankPayload, importPayload] = await Promise.all([
				fetchJson<{ accounts: Account[] }>('/api/accounts'),
				fetchJson<{ banks: BankScheme[] }>('/api/banks'),
				fetchJson<{ imports: ImportBatch[] }>('/api/imports')
			]);

			accounts = accountPayload.accounts;
			schemes = bankPayload.banks.filter((scheme) => scheme.status === 'enabled');
			imports = importPayload.imports;
			selectedAccountId = selectedAccountId || accounts[0]?.id || '';
			selectedAdapterId = selectedAdapterId || schemes[0]?.id || '';
			status = m.import_status_ready();
		} catch {
			status = m.import_status_error();
			error = m.import_status_error();
		}
	}

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		selectedFile = input.files?.[0] ?? null;
		preview = null;
		report = null;
	}

	async function previewImport(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedFile) return;

		isPreviewing = true;
		error = null;
		report = null;

		try {
			const payload = await fetchJson<{ preview: ImportPreview }>('/api/imports/preview', {
				method: 'POST',
				body: buildImportFormData()
			});

			preview = payload.preview;
			status = m.import_status_previewed();
		} catch {
			status = m.import_status_error();
			error = m.import_status_error();
		} finally {
			isPreviewing = false;
		}
	}

	async function confirmImport() {
		if (!preview || !selectedFile) return;

		isConfirming = true;
		error = null;

		try {
			const form = buildImportFormData();
			form.set('expectedHash', preview.fileHash);
			const payload = await fetchJson<{ report: ImportReport }>('/api/imports/confirm', {
				method: 'POST',
				body: form
			});

			report = payload.report;
			preview = null;
			status = m.import_status_confirmed();
			await loadImportState();
		} catch {
			status = m.import_status_error();
			error = m.import_status_error();
		} finally {
			isConfirming = false;
		}
	}

	async function deleteImport(batch: ImportBatch) {
		deletingImportId = batch.id;
		error = null;

		try {
			await fetchJson(`/api/imports/${batch.id}`, {
				method: 'DELETE'
			});
			status = m.import_status_deleted();
			await loadImportState();
		} catch {
			status = m.import_status_error();
			error = m.import_status_error();
		} finally {
			deletingImportId = null;
		}
	}

	function buildImportFormData(): FormData {
		if (!selectedFile) {
			throw new Error('file is required');
		}

		const form = new FormData();
		form.set('accountId', selectedAccountId);
		form.set('adapterId', selectedAdapterId);
		form.set('file', selectedFile);
		return form;
	}

	async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		return fetchJsonWithRetry<T>(url, init);
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

	function formatDateTime(value: string): string {
		return new Date(value).toLocaleString();
	}

	function schemeLabel(adapterId: BankId): string {
		return schemes.find((scheme) => scheme.id === adapterId)?.label ?? adapterId;
	}
</script>

<svelte:head>
	<title>{m.nav_imports()} / {m.app_title()}</title>
	<meta name="description" content={m.imports_subtitle()} />
</svelte:head>

<main class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,24rem)_1fr] lg:py-8">
	<section class="space-y-2 lg:col-span-2">
		<h1 class="text-3xl font-semibold tracking-normal text-zinc-950">{m.imports_title()}</h1>
		<p class="max-w-3xl text-sm leading-6 text-zinc-600">{m.imports_subtitle()}</p>
		<p class="text-sm text-zinc-500">{status}</p>
	</section>

	<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
		<h2 class="text-lg font-semibold text-zinc-950">{m.import_upload_title()}</h2>
		<form class="mt-5 grid gap-4" onsubmit={previewImport}>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.account()}</span>
				<Picker
					ariaLabel={m.account()}
					placeholder={m.required()}
					options={accounts.map((account) => ({ value: account.id, label: account.name }))}
					bind:value={selectedAccountId}
				/>
			</label>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.csv_scheme()}</span>
				<Picker
					ariaLabel={m.csv_scheme()}
					placeholder={m.required()}
					options={schemes.map((scheme) => ({ value: scheme.id, label: scheme.label }))}
					bind:value={selectedAdapterId}
				/>
			</label>
			<label class="grid gap-1 text-sm font-medium text-zinc-700">
				<span>{m.csv_file()}</span>
				<input
					class="w-full rounded border border-zinc-300 text-sm file:mr-3 file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-950"
					type="file"
					accept=".csv,text/csv"
					onchange={handleFileChange}
					required
				/>
			</label>
			<button
				class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
				type="submit"
				disabled={!canPreview}
			>
				{isPreviewing ? m.import_status_loading() : m.preview_import()}
			</button>
		</form>

		{#if error}
			<p class="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
				{error}
			</p>
		{/if}

		{#if accounts.length === 0}
			<p class="mt-4 text-sm leading-6 text-zinc-600">{m.no_accounts()}</p>
		{/if}
	</section>

	<section class="grid gap-6">
		<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<h2 class="text-lg font-semibold text-zinc-950">{m.import_preview_title()}</h2>
				{#if preview}
					<button
						class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
						type="button"
						disabled={!canConfirm}
						onclick={confirmImport}
					>
						{isConfirming ? m.import_status_loading() : m.confirm_import()}
					</button>
				{/if}
			</div>

			{#if preview}
				<div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.parsed_rows()}</p>
						<p class="mt-1 text-2xl font-semibold">{preview.summary.parsedRows}</p>
					</article>
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.duplicate_estimate()}</p>
						<p class="mt-1 text-2xl font-semibold">{preview.summary.duplicateEstimate}</p>
					</article>
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.parse_errors()}</p>
						<p class="mt-1 text-2xl font-semibold">{preview.summary.errorCount}</p>
					</article>
					<article class="rounded-ui border border-zinc-200 p-4">
						<p class="text-sm text-zinc-500">{m.date_range()}</p>
						<p class="mt-1 text-sm font-semibold">
							{formatDate(preview.summary.startDate)} - {formatDate(preview.summary.endDate)}
						</p>
					</article>
				</div>

				<div class="mt-6 overflow-x-auto">
					<table class="min-w-full divide-y divide-zinc-200 text-left text-sm">
						<thead class="text-xs uppercase text-zinc-500">
							<tr>
								<th class="px-3 py-2">{m.date()}</th>
								<th class="px-3 py-2">{m.payee()}</th>
								<th class="px-3 py-2">{m.description()}</th>
								<th class="px-3 py-2 text-right">{m.amount()}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-zinc-100">
							{#each preview.sampleRows as row (row.dedupeKey)}
								<tr>
									<td class="px-3 py-2">{formatDate(row.bookingDate)}</td>
									<td class="px-3 py-2">{row.payee || m.not_available()}</td>
									<td class="px-3 py-2">{row.description || m.not_available()}</td>
									<td class="px-3 py-2 text-right font-medium">{centsToEuros(row.amountCents)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				{#if preview.errors.length > 0}
					<div class="mt-6 rounded border border-amber-200 bg-amber-50 p-4">
						<h3 class="text-sm font-semibold text-amber-950">{m.parse_errors()}</h3>
						<ul class="mt-2 space-y-1 text-sm text-amber-900">
							{#each preview.errors as parseError (`${parseError.rowNumber}-${parseError.code}-${parseError.message}`)}
								<li>{parseError.rowNumber}: {parseError.message}</li>
							{/each}
						</ul>
					</div>
				{/if}
			{:else}
				<p class="mt-5 text-sm leading-6 text-zinc-600">{m.no_import_preview()}</p>
			{/if}
		</section>

		{#if report}
			<section class="rounded border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
				<h2 class="text-lg font-semibold text-emerald-950">{m.import_report_title()}</h2>
				<div class="mt-4 grid gap-3 sm:grid-cols-4">
					<p class="text-sm text-emerald-900">{m.imported_rows()}: {report.importedCount}</p>
					<p class="text-sm text-emerald-900">{m.duplicate_rows()}: {report.duplicateCount}</p>
					<p class="text-sm text-emerald-900">{m.parse_errors()}: {report.errorCount}</p>
					<p class="text-sm text-emerald-900">{m.unknown_transactions()}: {report.unknownCount}</p>
				</div>
			</section>
		{/if}

		<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.import_history_title()}</h2>
			<div class="mt-5 divide-y divide-zinc-200">
				{#if imports.length === 0}
					<p class="py-4 text-sm text-zinc-500">{m.no_import_batches()}</p>
				{:else}
					{#each imports as batch (batch.id)}
						<article class="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
							<div>
								<h3 class="font-semibold text-zinc-950">
									{batch.accountName} / {schemeLabel(batch.adapterId)}
								</h3>
								<p class="mt-1 text-sm text-zinc-500">
									{formatDate(batch.startDate)} - {formatDate(batch.endDate)} / {formatDateTime(
										batch.createdAt
									)}
								</p>
							</div>
							<div class="grid gap-2 text-sm text-zinc-700 sm:justify-items-end">
								<p>
									{m.imported_rows()}: {batch.importedCount} / {m.duplicate_rows()}:
									{batch.duplicateCount}
								</p>
								<button
									class="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
									type="button"
									disabled={deletingImportId === batch.id}
									onclick={() => deleteImport(batch)}
								>
									{m.delete_import_batch()}
								</button>
							</div>
						</article>
					{/each}
				{/if}
			</div>
		</section>
	</section>
</main>
