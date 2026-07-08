<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { onMount } from 'svelte';

	type BankId = 'n26' | 'trade_republic' | 'dkb';

	interface AccountWithProfile {
		id: string;
		name: string;
		institution: string | null;
		openingBalanceCents: number;
		profile: { id: string; bankId: BankId; label: string } | null;
	}

	const bankOptions: Array<{ id: BankId; label: string }> = [
		{ id: 'dkb', label: 'DKB' },
		{ id: 'n26', label: 'N26' },
		{ id: 'trade_republic', label: 'Trade Republic' }
	];

	let accounts = $state<AccountWithProfile[]>([]);
	let status = $state(m.setup_status_loading());
	let error = $state<string | null>(null);
	let accountName = $state('');
	let institution = $state('');
	let openingBalance = $state('0.00');
	let profileAccountId = $state('');
	let profileLabel = $state('');
	let profileBankId = $state<BankId>('dkb');
	let isSaving = $state(false);

	onMount(() => {
		void loadAccounts();
	});

	async function loadAccounts() {
		status = m.setup_status_loading();
		error = null;

		try {
			const response = await fetch('/api/accounts');
			if (!response.ok) {
				throw new Error(await response.text());
			}

			const payload = (await response.json()) as { accounts: AccountWithProfile[] };
			accounts = payload.accounts;
			profileAccountId = profileAccountId || payload.accounts[0]?.id || '';
			status = m.setup_status_ready();
		} catch {
			status = m.setup_status_error();
			error = m.setup_status_error();
		}
	}

	async function createAccount(event: SubmitEvent) {
		event.preventDefault();
		isSaving = true;
		error = null;

		try {
			const response = await fetch('/api/accounts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: accountName,
					institution: institution || null,
					openingBalanceCents: eurosToCents(openingBalance)
				})
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

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
			const response = await fetch('/api/profiles', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: profileAccountId,
					bankId: profileBankId,
					label: profileLabel
				})
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

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

	function eurosToCents(value: string): number {
		const normalized = value.trim().replace(',', '.');
		const parsed = Number.parseFloat(normalized);
		return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
	}

	function centsToEuros(value: number): string {
		return (value / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: 'EUR'
		});
	}
</script>

<svelte:head>
	<title>{m.app_title()}</title>
	<meta name="description" content={m.app_subtitle()} />
</svelte:head>

<main class="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[1fr_1fr] lg:py-12">
	<section class="space-y-6 lg:col-span-2">
		<div
			class="inline-flex rounded border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800"
		>
			{m.phase_badge()}
		</div>
		<div class="max-w-3xl space-y-4">
			<h1 class="text-4xl font-semibold tracking-normal text-zinc-950 sm:text-5xl">
				{m.app_title()}
			</h1>
			<p class="text-lg leading-8 text-zinc-700">{m.app_subtitle()}</p>
		</div>
	</section>

	<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
		<div class="flex items-center justify-between gap-4">
			<h2 class="text-lg font-semibold text-zinc-950">{m.setup_title()}</h2>
			<p class="text-sm text-zinc-500">{status}</p>
		</div>

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

		<form class="mt-8 grid gap-4 border-t border-zinc-200 pt-5" onsubmit={createProfile}>
			<h3 class="text-base font-semibold text-zinc-950">{m.profile_title()}</h3>
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

		{#if error}
			<p class="mt-4 text-sm text-red-700">{error}</p>
		{/if}
	</section>

	<section class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
		<h2 class="text-lg font-semibold text-zinc-950">{m.accounts()}</h2>
		<div class="mt-5 divide-y divide-zinc-200">
			{#if accounts.length === 0}
				<p class="py-4 text-sm text-zinc-500">{m.no_accounts()}</p>
			{:else}
				{#each accounts as account (account.id)}
					<article class="py-4">
						<div class="flex items-start justify-between gap-4">
							<div>
								<h3 class="text-base font-semibold text-zinc-950">{account.name}</h3>
								<p class="mt-1 text-sm text-zinc-600">
									{account.institution || m.institution()} / {centsToEuros(
										account.openingBalanceCents
									)}
								</p>
							</div>
							<p class="text-right text-sm text-zinc-600">
								{account.profile ? account.profile.label : m.no_profile()}
							</p>
						</div>
					</article>
				{/each}
			{/if}
		</div>
		<div class="mt-5 border-t border-zinc-200 pt-4">
			<p class="text-sm leading-6 text-zinc-700">{m.privacy_note()}</p>
		</div>
	</section>
</main>
