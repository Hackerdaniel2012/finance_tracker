<script lang="ts">
	import { getLocale } from '$lib/paraglide/runtime';
	import { onMount } from 'svelte';

	let {
		value = $bindable(''),
		ariaLabel,
		todayLabel,
		clearLabel,
		previousMonthLabel,
		nextMonthLabel,
		disabled = false,
		allowClear = true
	}: {
		value?: string;
		ariaLabel: string;
		todayLabel: string;
		clearLabel: string;
		previousMonthLabel: string;
		nextMonthLabel: string;
		disabled?: boolean;
		allowClear?: boolean;
	} = $props();

	let open = $state(false);
	let container = $state<HTMLDivElement>();
	let visibleMonth = $state(startOfMonth(value || todayIso()));
	const locale = $derived(getLocale());
	const days = $derived(calendarDays(visibleMonth));

	function toggle(): void {
		if (!open) visibleMonth = startOfMonth(value || todayIso());
		open = !open;
	}

	function selectDate(date: string): void {
		value = date;
		open = false;
	}

	function shiftMonth(offset: number): void {
		const date = parseIso(visibleMonth);
		date.setUTCMonth(date.getUTCMonth() + offset);
		visibleMonth = date.toISOString().slice(0, 10);
	}

	function displayDate(date: string): string {
		if (!date) return ariaLabel;
		return new Intl.DateTimeFormat(locale, {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(parseIso(date));
	}

	function monthLabel(date: string): string {
		return new Intl.DateTimeFormat(locale, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(parseIso(date));
	}

	function weekdayLabels(): string[] {
		const monday = new Date(Date.UTC(2026, 0, 5));
		return Array.from({ length: 7 }, (_, index) => {
			const date = new Date(monday);
			date.setUTCDate(date.getUTCDate() + index);
			return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date);
		});
	}

	onMount(() => {
		const close = (event: PointerEvent): void => {
			if (container && !container.contains(event.target as Node)) open = false;
		};
		document.addEventListener('pointerdown', close);
		return () => document.removeEventListener('pointerdown', close);
	});

	function todayIso(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function parseIso(date: string): Date {
		return new Date(`${date}T00:00:00.000Z`);
	}

	function startOfMonth(date: string): string {
		return `${date.slice(0, 7)}-01`;
	}

	function calendarDays(month: string): Array<{ date: string; day: number; current: boolean }> {
		const first = parseIso(month);
		const mondayOffset = (first.getUTCDay() + 6) % 7;
		const start = new Date(first);
		start.setUTCDate(start.getUTCDate() - mondayOffset);
		return Array.from({ length: 42 }, (_, index) => {
			const date = new Date(start);
			date.setUTCDate(date.getUTCDate() + index);
			const iso = date.toISOString().slice(0, 10);
			return { date: iso, day: date.getUTCDate(), current: iso.slice(0, 7) === month.slice(0, 7) };
		});
	}
</script>

<div class="relative min-w-0" bind:this={container}>
	<button
		class="flex h-11 w-full min-w-0 items-center justify-between gap-3 rounded-ui border border-zinc-300 bg-white px-5 text-left text-base font-semibold text-zinc-950 shadow-[inset_0_0_0_1px_rgb(212_212_216_/_0.2)] disabled:cursor-not-allowed disabled:opacity-50"
		type="button"
		aria-label={ariaLabel}
		aria-haspopup="dialog"
		aria-expanded={open}
		{disabled}
		onclick={toggle}
	>
		<span>{displayDate(value)}</span>
		<svg
			class="size-5 shrink-0"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
			><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg
		>
	</button>

	{#if open}
		<div
			class="absolute left-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-ui border border-zinc-200 bg-white p-4 shadow-xl"
			role="dialog"
			aria-label={ariaLabel}
		>
			<div class="flex items-center justify-between gap-3">
				<p class="font-semibold capitalize text-zinc-950">{monthLabel(visibleMonth)}</p>
				<div class="flex gap-2">
					<button
						class="flex size-11 items-center justify-center rounded-full bg-zinc-50"
						type="button"
						aria-label={previousMonthLabel}
						onclick={() => shiftMonth(-1)}>‹</button
					>
					<button
						class="flex size-11 items-center justify-center rounded-full bg-zinc-50"
						type="button"
						aria-label={nextMonthLabel}
						onclick={() => shiftMonth(1)}>›</button
					>
				</div>
			</div>
			<div class="mt-4 grid grid-cols-7 text-center text-xs font-medium uppercase text-zinc-500">
				{#each weekdayLabels() as weekday}<span>{weekday}</span>{/each}
			</div>
			<div class="mt-2 grid grid-cols-7 gap-1">
				{#each days as item (item.date)}
					<button
						class={`flex size-11 items-center justify-center justify-self-center rounded-full text-sm ${item.date === value ? 'bg-blue-600 text-white' : item.current ? 'text-zinc-950 hover:bg-zinc-100' : 'text-zinc-400 hover:bg-zinc-50'}`}
						type="button"
						aria-label={displayDate(item.date)}
						onclick={() => selectDate(item.date)}>{item.day}</button
					>
				{/each}
			</div>
			<div class="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-200 pt-4">
				{#if allowClear}<button
						class="h-11 rounded-ui bg-red-600 px-4 text-sm font-medium text-white"
						type="button"
						onclick={() => selectDate('')}>{clearLabel}</button
					>{:else}<span></span>{/if}
				<button
					class="h-11 rounded-ui bg-zinc-950 px-4 text-sm font-medium text-white"
					type="button"
					onclick={() => selectDate(todayIso())}>{todayLabel}</button
				>
			</div>
		</div>
	{/if}
</div>
