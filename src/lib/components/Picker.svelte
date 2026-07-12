<script lang="ts">
	import { onMount, tick } from 'svelte';

	export interface PickerOption {
		value: string;
		label: string;
		disabled?: boolean;
	}

	let {
		value = $bindable(''),
		options,
		placeholder,
		ariaLabel,
		disabled = false,
		onchange,
		class: className = ''
	}: {
		value?: string;
		options: PickerOption[];
		placeholder: string;
		ariaLabel: string;
		disabled?: boolean;
		onchange?: () => void;
		class?: string;
	} = $props();

	let open = $state(false);
	let container = $state<HTMLDivElement>();
	let menuMaxHeight = $state('');
	const selected = $derived(options.find((option) => option.value === value));

	function close(): void {
		open = false;
	}

	async function toggle(): Promise<void> {
		open = !open;
		if (!open) return;
		await tick();
		updateMenuMaxHeight();
	}

	function updateMenuMaxHeight(): void {
		if (!container) return;
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
		const availableHeight = viewportHeight - container.getBoundingClientRect().bottom - 8 - 16;
		menuMaxHeight = `${Math.max(0, availableHeight)}px`;
	}

	function choose(option: PickerOption): void {
		if (option.disabled) return;
		value = option.value;
		onchange?.();
		close();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			close();
			return;
		}

		if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
			event.preventDefault();
			void toggle();
		}
	}

	onMount(() => {
		const handlePointerDown = (event: PointerEvent): void => {
			if (container && !container.contains(event.target as Node)) close();
		};
		document.addEventListener('pointerdown', handlePointerDown);
		window.addEventListener('resize', updateMenuMaxHeight);
		window.visualViewport?.addEventListener('resize', updateMenuMaxHeight);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			window.removeEventListener('resize', updateMenuMaxHeight);
			window.visualViewport?.removeEventListener('resize', updateMenuMaxHeight);
		};
	});
</script>

<div class={`relative ${className}`} bind:this={container}>
	<button
		class="flex h-11 w-full items-center justify-between gap-3 rounded-ui border border-zinc-300 bg-white px-5 py-2 text-left text-base font-semibold text-zinc-950 shadow-[inset_0_0_0_1px_rgb(212_212_216_/_0.2)] transition focus:border-blue-600 focus:outline-2 focus:outline-offset-2 focus:outline-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
		type="button"
		aria-label={ariaLabel}
		aria-haspopup="listbox"
		aria-expanded={open}
		disabled={disabled}
		onclick={() => void toggle()}
		onkeydown={handleKeydown}
	>
		<span class={selected ? '' : 'text-zinc-500'}>{selected?.label ?? placeholder}</span>
		<svg
			class={`size-5 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="m6 9 6 6 6-6" />
		</svg>
	</button>

	{#if open}
		<div
			class="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-full overflow-hidden rounded-ui border border-zinc-200 bg-white shadow-xl"
			style={`max-height: ${menuMaxHeight}`}
			role="listbox"
			aria-label={ariaLabel}
		>
			<div class="max-h-full overflow-y-auto overscroll-contain p-2" style={`max-height: ${menuMaxHeight}`}>
				{#each options as option, index (option.value)}
					<button
						class={`flex min-h-11 w-full items-center rounded-ui px-4 py-2 text-left text-base font-medium transition-colors ${option.value === value ? 'bg-blue-100 text-blue-700' : 'text-zinc-700 hover:bg-zinc-50'} disabled:cursor-not-allowed disabled:opacity-50`}
						type="button"
						role="option"
						aria-selected={option.value === value}
						disabled={option.disabled}
						onclick={() => choose(option)}
					>
						{option.label}
					</button>
					{#if index < options.length - 1}
						<div class="mx-4 my-2 h-px bg-zinc-100" aria-hidden="true"></div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>
