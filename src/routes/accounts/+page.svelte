<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>{m.account_summary_title()} | {m.app_title()}</title>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 py-8">
	<h1 class="text-2xl font-semibold text-zinc-950">{m.account_summary_title()}</h1>
	<p class="mt-4 text-zinc-600">{m.no_accounts()}</p>
	<a
		class="mt-4 inline-block rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
		href={resolve('/')}>{m.create_account()}</a
	>
</main>
