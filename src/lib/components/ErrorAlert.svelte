<script lang="ts">
	type RetryCallback = () => void | Promise<void>;

	let {
		message,
		retry,
		retryLabel,
		class: className = ''
	}: {
		message: string;
		retry?: RetryCallback;
		retryLabel?: string;
		class?: string;
	} = $props();
</script>

<div
	class={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 ${className}`}
	role="alert"
>
	<p>{message}</p>
	{#if retry && retryLabel}
		<button
			type="button"
			class="font-semibold text-red-700 underline decoration-red-300 underline-offset-4 hover:text-red-900"
			onclick={() => void retry()}
		>
			{retryLabel}
		</button>
	{/if}
</div>
