<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { fetchJsonWithRetry } from '$lib/fetch-json';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import Picker from '$lib/components/Picker.svelte';
	import type { PageData } from './$types';

	interface AccountWithBalance {
		id: string;
		name: string;
		institution: string | null;
		openingBalanceCents: number;
		currentBalanceCents: number | null;
		balanceCents: number;
	}

	let { data } = $props<{ data: PageData }>();

	let accounts = $state<AccountWithBalance[]>(untrack(() => data.accounts as AccountWithBalance[]));
	let status = $state(m.setup_status_ready());
	let error = $state<string | null>(null);
	let accountName = $state('');
	let institutionChoice = $state('');
	let customInstitution = $state('');
	let currentBalance = $state('');
	let isSaving = $state(false);
	let deletingAccountId = $state<string | null>(null);

	async function createAccount(event: SubmitEvent) {
		event.preventDefault();
		isSaving = true;
		error = null;

		try {
			await fetchJson('/api/accounts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: accountName,
					institution:
						institutionChoice === 'other'
							? customInstitution.trim() || null
							: institutionChoice || null,
					currentBalanceCents: currentBalance.trim() === '' ? null : eurosToCents(currentBalance)
				})
			});

			accountName = '';
			institutionChoice = '';
			customInstitution = '';
			currentBalance = '';
			status = m.setup_status_saved();
			await loadAccounts();
		} catch {
			status = m.setup_status_error();
			error = m.setup_status_error();
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
		error = null;

		try {
			await fetchJson(`/api/accounts/${account.id}`, {
				method: 'DELETE'
			});

			status = m.account_deleted();
			await loadAccounts();
		} catch {
			status = m.setup_status_error();
			error = m.setup_status_error();
		} finally {
			deletingAccountId = null;
		}
	}

	async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
		return fetchJsonWithRetry<T>(url, init);
	}

	function eurosToCents(value: string): number {
		const parsed = Number.parseFloat(value.trim().replace(',', '.'));
		return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
	}

	function accountBalance(account: AccountWithBalance): number {
		return account.balanceCents;
	}
</script>

<svelte:head>
	<title>{m.account_summary_title()} | {m.app_title()}</title>
</svelte:head>

<main class="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:py-8">
	<section class="space-y-2 lg:col-span-2">
		<h1 class="text-3xl font-semibold text-zinc-950">{m.account_summary_title()}</h1>
		<p class="text-sm text-zinc-500">{status}</p>
		{#if error}
			<p class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
		{/if}
	</section>

	<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
		<h2 class="text-lg font-semibold text-zinc-950">{m.accounts()}</h2>
		<div class="mt-5 divide-y divide-zinc-200">
			{#if accounts.length === 0}
				<p class="py-4 text-sm text-zinc-500">{m.no_accounts()}</p>
			{:else}
				{#each accounts as account (account.id)}
					<article class="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
						<div>
							<h3 class="font-semibold text-zinc-950">{account.name}</h3>
							<p class="mt-1 text-sm text-zinc-600">
								{account.institution || m.institution()} / {centsToEuros(accountBalance(account))}
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
								class="rounded border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
								type="button"
								disabled={deletingAccountId === account.id}
								onclick={() => deleteAccount(account)}
							>
								{m.delete_account()}
							</button>
						</div>
					</article>
				{/each}
			{/if}
		</div>
	</section>

	<aside class="space-y-6">
		<section class="rounded-ui border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.setup_title()}</h2>
			<form class="mt-5 grid gap-4" onsubmit={createAccount}>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.account_name()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={accountName} required />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
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
				</label>
				{#if institutionChoice === 'other'}
					<label class="grid gap-1 text-sm font-medium text-zinc-700">
						<span>{m.institution_custom_name()}</span>
						<input
							class="w-full rounded border-zinc-300"
							bind:value={customInstitution}
							required
						/>
					</label>
				{/if}
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.current_balance()}</span>
					<input
						class="w-full rounded border-zinc-300"
						inputmode="decimal"
						bind:value={currentBalance}
					/>
				</label>
				<button
					class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					type="submit"
					disabled={isSaving}
				>
					{m.create_account()}
				</button>
			</form>
		</section>

	</aside>
</main>
