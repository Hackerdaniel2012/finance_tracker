<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="min-h-screen bg-stone-50 text-zinc-950">
	<header class="border-b border-zinc-200 bg-white">
		<div
			class="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between"
		>
			<a href={resolve('/')} class="text-lg font-semibold">{m.app_title()}</a>
			<nav class="flex flex-wrap gap-1 text-sm text-zinc-600" aria-label="Primary navigation">
				<a class="rounded px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950" href={resolve('/')}
					>{m.nav_dashboard()}</a
				>
				<a
					class="rounded px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950"
					href={resolve('/accounts')}>{m.nav_accounts()}</a
				>
				<a
					class="rounded px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950"
					href={resolve('/imports')}>{m.nav_imports()}</a
				>
				<a
					class="rounded px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950"
					href={resolve('/transactions')}>{m.nav_transactions()}</a
				>
				<a class="rounded px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950" href={resolve('/review')}
					>{m.nav_review()}</a
				>
				<a
					class="rounded px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950"
					href={resolve('/planning')}>{m.nav_planning()}</a
				>
			</nav>
		</div>
	</header>
	{@render children()}
</div>

<div class="hidden">
	{#each locales as locale (locale)}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={localizeHref(page.url.pathname, { locale })}>{locale}</a>
	{/each}
</div>
