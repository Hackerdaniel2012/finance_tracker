<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	type BankId = 'n26' | 'trade_republic' | 'dkb';

	interface AccountWithProfile {
		id: string;
		name: string;
		institution: string | null;
		openingBalanceCents: number;
		currentBalanceCents: number | null;
		profile: { id: string; bankId: BankId; label: string } | null;
	}

	const bankOptions: Array<{ id: BankId; label: string }> = [
		{ id: 'dkb', label: 'DKB' },
		{ id: 'n26', label: 'N26' },
		{ id: 'trade_republic', label: 'Trade Republic' }
	];

	let { data } = $props<{ data: PageData }>();

	let accounts = $state<AccountWithProfile[]>(untrack(() => data.accounts as AccountWithProfile[]));
	let status = $state(m.setup_status_ready());
	let error = $state<string | null>(null);
	let accountName = $state('');
	let institution = $state('');
	let openingBalance = $state('0.00');
	let profileAccountId = $state(untrack(() => accounts[0]?.id ?? ''));
	let profileBankId = $state<BankId>('dkb');
	let profileLabel = $state('');
	let isSaving = $state(false);

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
					institution: institution || null,
					openingBalanceCents: eurosToCents(openingBalance)
				})
			});

			accountName = '';
			institution = '';
			openingBalance = '0.00';
			status = m.setup_status_saved();
			await loadAccounts();
		} catch {
			status = m.setup_status_error();
			error = m.setup_status_error();
		} finally {
			isSaving = false;
		}
	}

	async function createProfile(event: SubmitEvent) {
		event.preventDefault();
		isSaving = true;
		error = null;

		try {
			await fetchJson('/api/profiles', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: profileAccountId,
					bankId: profileBankId,
					label: profileLabel
				})
			});

			profileLabel = '';
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
		const payload = await fetchJson<{ accounts: AccountWithProfile[] }>('/api/accounts');
		accounts = payload.accounts;
		profileAccountId = profileAccountId || accounts[0]?.id || '';
	}

	async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
		if (!response.ok) {
			throw new Error(await response.text());
		}

		return (await response.json()) as T;
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

	function accountBalance(account: AccountWithProfile): number {
		return account.currentBalanceCents ?? account.openingBalanceCents;
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

	<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
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
							<p class="mt-1 text-sm text-zinc-500">
								{account.profile
									? `${account.profile.label} / ${account.profile.bankId}`
									: m.no_profile()}
							</p>
						</div>
						<a
							class="rounded border border-zinc-300 px-3 py-2 text-center text-sm font-medium text-zinc-950"
							href={resolve(`/accounts/${account.id}`)}
						>
							{m.view_account()}
						</a>
					</article>
				{/each}
			{/if}
		</div>
	</section>

	<aside class="space-y-6">
		<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.setup_title()}</h2>
			<form class="mt-5 grid gap-4" onsubmit={createAccount}>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.account_name()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={accountName} required />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.institution()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={institution} />
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.opening_balance()}</span>
					<input
						class="w-full rounded border-zinc-300"
						inputmode="decimal"
						bind:value={openingBalance}
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

		<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
			<h2 class="text-lg font-semibold text-zinc-950">{m.profile_title()}</h2>
			<form class="mt-5 grid gap-4" onsubmit={createProfile}>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.account()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={profileAccountId} required>
						<option value="">{m.required()}</option>
						{#each accounts as account (account.id)}
							<option value={account.id}>{account.name}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.bank()}</span>
					<select class="w-full rounded border-zinc-300" bind:value={profileBankId}>
						{#each bankOptions as bank (bank.id)}
							<option value={bank.id}>{bank.label}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-sm font-medium text-zinc-700">
					<span>{m.profile_label()}</span>
					<input class="w-full rounded border-zinc-300" bind:value={profileLabel} required />
				</label>
				<button
					class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
					type="submit"
					disabled={isSaving || accounts.length === 0}
				>
					{m.create_profile()}
				</button>
			</form>
		</section>
	</aside>
</main>
