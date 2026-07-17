<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import ButtonSpinner from '$lib/components/ButtonSpinner.svelte';
	import ErrorAlert from '$lib/components/ErrorAlert.svelte';
	import InlineSuccess from '$lib/components/InlineSuccess.svelte';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import Picker from '$lib/components/Picker.svelte';
	import type { PageData } from './$types';

	interface AccountWithBalance {
		id: string;
		name: string;
		institution: string | null;
		balanceCents: number | null;
		balanceInitialized: boolean;
	}

	let { data } = $props<{ data: PageData }>();

	let accounts = $state<AccountWithBalance[]>(untrack(() => data.accounts as AccountWithBalance[]));
	let createError = $state<string | null>(null);
	let listError = $state<string | null>(null);
	let createSuccess = $state<string | null>(null);
	let listSuccess = $state<string | null>(null);
	let accountName = $state('');
	let institutionChoice = $state('');
	let customInstitution = $state('');
	let isSaving = $state(false);
	let deletingAccountId = $state<string | null>(null);

	async function createAccount(event: SubmitEvent) {
		event.preventDefault();
		isSaving = true;
		createError = null;
		createSuccess = null;

		try {
			await fetchJson('/api/accounts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: accountName,
					institution:
						institutionChoice === 'other'
							? customInstitution.trim() || null
							: institutionChoice || null
				})
			});

			accountName = '';
			institutionChoice = '';
			customInstitution = '';
			await loadAccounts();
			createSuccess = m.account_created_success();
		} catch {
			createError = m.account_create_error();
		} finally {
			isSaving = false;
		}
	}

	async function loadAccounts() {
		const payload = await fetchJson<{ accounts: AccountWithBalance[] }>('/api/accounts');
		accounts = payload.accounts;
	}

	async function deleteAccount(account: AccountWithBalance) {
		if (!confirm(m.delete_account_confirm({ name: account.name }))) {
			return;
		}

		deletingAccountId = account.id;
		listError = null;
		listSuccess = null;

		try {
			await fetchJson(`/api/accounts/${account.id}`, {
				method: 'DELETE'
			});

			await loadAccounts();
			listSuccess = m.account_deleted_success();
		} catch {
			listError = m.account_delete_error();
		} finally {
			deletingAccountId = null;
		}
	}

	async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
		return fetchJsonWithRetry<T>(url, init);
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
	}
</script>

<svelte:head>
	<title>{m.account_summary_title()} | {m.app_title()}</title>
</svelte:head>

<main
	class="mx-auto grid max-w-[90rem] gap-6 px-6 pb-[50px] pt-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:pt-8"
>
	<section class="rounded-ui border border-zinc-200 bg-white p-5">
		<h2 class="text-lg font-semibold text-zinc-950">{m.accounts()}</h2>
		{#if listError}<ErrorAlert class="mt-4" message={listError} />{/if}
		{#if listSuccess}
			<div class="mt-4">
				<InlineSuccess message={listSuccess} onDismiss={() => (listSuccess = null)} />
			</div>
		{/if}
		<div class="mt-5 divide-y divide-zinc-200">
			{#if accounts.length === 0}
				<p class="py-4 text-sm text-zinc-500">{m.no_accounts()}</p>
			{:else}
				{#each accounts as account (account.id)}
					<article class="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
						<div>
							<h3 class="font-semibold text-zinc-950">{account.name}</h3>
							<p class="mt-1 text-sm text-zinc-600">
								{account.institution || m.institution()} / {account.balanceCents === null
									? m.balance_not_initialized()
									: centsToEuros(account.balanceCents)}
							</p>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<a
								class="rounded border border-zinc-300 px-3 py-2 text-center text-sm font-medium text-zinc-950"
								href={resolve(`/accounts/${account.id}`)}
							>
								{m.view_account()}
							</a>
							<button
								class="flex h-11 items-center gap-2 rounded border border-red-200 px-3 text-sm font-medium text-red-700 disabled:opacity-50"
								type="button"
								disabled={deletingAccountId === account.id}
								aria-busy={deletingAccountId === account.id}
								onclick={() => deleteAccount(account)}
							>
								{#if deletingAccountId === account.id}<ButtonSpinner />{/if}
								{m.delete_account()}
							</button>
						</div>
					</article>
				{/each}
			{/if}
		</div>
	</section>

	<aside class="space-y-6">
		<section class="rounded-ui border border-zinc-200 bg-white p-5">
			<h2 class="text-lg font-semibold text-zinc-950">{m.setup_title()}</h2>
			{#if createError}<ErrorAlert class="mt-4" message={createError} />{/if}
			{#if createSuccess}
				<div class="mt-4">
					<InlineSuccess message={createSuccess} onDismiss={() => (createSuccess = null)} />
				</div>
			{/if}
			<form class="mt-5 grid gap-4" onsubmit={createAccount}>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.account_name()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={accountName} required />
				</label>
				<div class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.institution()}</span>
					<Picker
						ariaLabel={m.institution()}
						placeholder={m.institution_not_selected()}
						options={[
							{ value: 'DKB', label: m.institution_dkb() },
							{ value: 'N26', label: m.institution_n26() },
							{ value: 'Trade Republic', label: m.institution_trade_republic() },
							{ value: 'other', label: m.institution_other() }
						]}
						bind:value={institutionChoice}
					/>
				</div>
				{#if institutionChoice === 'other'}
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.institution_custom_name()}</span>
						<input class="w-full rounded border-zinc-300" bind:value={customInstitution} required />
					</label>
				{/if}
				<button
					class="flex h-11 items-center justify-center gap-2 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
					type="submit"
					disabled={isSaving}
					aria-busy={isSaving}
				>
					{#if isSaving}<ButtonSpinner />{/if}
					{m.create_account()}
				</button>
			</form>
		</section>
	</aside>
</main>
