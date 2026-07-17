<script lang="ts">
	let {
		class: className = '',
		rounded = 'rounded-2xl'
	}: {
		class?: string;
		rounded?: string;
	} = $props();
</script>

<div class={`skeleton-shimmer ${rounded} ${className}`} aria-hidden="true"></div>
