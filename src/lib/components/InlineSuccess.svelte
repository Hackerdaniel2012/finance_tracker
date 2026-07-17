<script lang="ts">
	let {
		message,
		duration = 3000,
		onDismiss
	}: {
		message: string;
		duration?: number;
		onDismiss: () => void;
	} = $props();

	$effect(() => {
		if (!message) return;

		const timer = window.setTimeout(onDismiss, duration);
		return () => window.clearTimeout(timer);
	});
</script>

<p
	class="inline-flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800"
	aria-live="polite"
>
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="size-4 shrink-0"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" />
	</svg>
	{message}
</p>
