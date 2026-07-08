<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.app_title()}</title>
	<meta name="description" content={m.app_subtitle()} />
</svelte:head>

<main class="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[1.4fr_0.9fr] lg:py-12">
	<section class="space-y-6">
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

	<aside class="rounded border border-zinc-200 bg-white p-5 shadow-sm">
		<div class="space-y-4">
			<p class="text-sm font-medium uppercase tracking-normal text-zinc-500">{m.status_ready()}</p>
			<p class="text-sm leading-6 text-zinc-700">{m.privacy_note()}</p>
			<div class="border-t border-zinc-200 pt-4">
				<h2 class="text-base font-semibold text-zinc-950">{m.next_step_title()}</h2>
				<p class="mt-2 text-sm leading-6 text-zinc-700">{m.next_step_body()}</p>
			</div>
		</div>
	</aside>
</main>
