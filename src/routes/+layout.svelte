<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getLocale, setLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
	const currentLocale = getLocale();
	let mobileNavigationOpen = $state(false);
	let menuOpen = $state(false);
	const toolbarControlClass =
		'rounded-full border border-zinc-200 bg-white/95 text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950';

	function isActive(path: string): boolean {
		return path === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(path);
	}

	function activePath(): string {
		if (isActive('/accounts')) return '/accounts';
		if (isActive('/imports')) return '/imports';
		if (isActive('/transactions')) return '/transactions';
		if (isActive('/review')) return '/review';
		if (isActive('/planning')) return '/planning';
		return '/';
	}

	function activeLabel(): string {
		switch (activePath()) {
			case '/accounts':
				return m.nav_accounts();
			case '/imports':
				return m.nav_imports();
			case '/transactions':
				return m.nav_transactions();
			case '/review':
				return m.nav_review();
			case '/planning':
				return m.nav_planning();
			default:
				return m.nav_dashboard();
		}
	}

	function switchLanguage(locale: 'en' | 'de'): void {
		menuOpen = false;
		setLocale(locale);
	}

	onMount(() => {
		const desktopBreakpoint = window.matchMedia('(min-width: 950px)');
		const closeMobileOverlays = (): void => {
			if (!desktopBreakpoint.matches) return;
			mobileNavigationOpen = false;
			menuOpen = false;
		};

		desktopBreakpoint.addEventListener('change', closeMobileOverlays);
		return () => desktopBreakpoint.removeEventListener('change', closeMobileOverlays);
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="min-h-screen min-w-[320px] bg-white text-zinc-950">
	<header class="toolbar-backdrop sticky top-0 z-30 px-4 py-4">
		{#if menuOpen || mobileNavigationOpen}
			<button
				class="radius-exempt fixed inset-0 z-30 cursor-default rounded-none bg-zinc-950/20"
				type="button"
				aria-label={m.close_navigation()}
				onclick={() => {
					menuOpen = false;
					mobileNavigationOpen = false;
				}}
			></button>
		{/if}
		<div class="relative grid w-full grid-cols-[4rem_minmax(0,1fr)_4rem] items-center gap-2">
			<nav
				class="col-start-2 hidden h-11 min-w-0 items-center justify-start gap-1 min-[950px]:mx-auto min-[950px]:flex min-[950px]:w-fit min-[950px]:max-w-full min-[950px]:justify-center"
				aria-label={m.primary_navigation()}
			>
				<a
					class={`inline-flex h-full shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium ${toolbarControlClass} ${isActive('/') ? '!bg-blue-50 !text-blue-600 hover:!bg-blue-50' : ''}`}
					href={resolve('/')}
					aria-current={isActive('/') ? 'page' : undefined}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5" aria-hidden="true">
						<path d="M4 19v-5" /><path d="M8 19V8" /><path d="M12 19v-9" /><path d="M16 19V4" /><path d="M20 19v-7" />
					</svg>
					<span>{m.nav_dashboard()}</span>
				</a>
				<a
					class={`inline-flex h-full shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium ${toolbarControlClass} ${isActive('/accounts') ? '!bg-blue-50 !text-blue-600 hover:!bg-blue-50' : ''}`}
					href={resolve('/accounts')}
					aria-current={isActive('/accounts') ? 'page' : undefined}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5" aria-hidden="true">
						<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8" /><path d="M3 10l18 0" /><path d="M7 15l.01 0" /><path d="M11 15l2 0" />
					</svg>
					<span>{m.nav_accounts()}</span>
				</a>
				<a
					class={`inline-flex h-full shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium ${toolbarControlClass} ${isActive('/imports') ? '!bg-blue-50 !text-blue-600 hover:!bg-blue-50' : ''}`}
					href={resolve('/imports')}
					aria-current={isActive('/imports') ? 'page' : undefined}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5" aria-hidden="true">
						<path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M5 20h14" /><path d="M5 20v-3" /><path d="M19 20v-3" />
					</svg>
					<span>{m.nav_imports()}</span>
				</a>
				<a
					class={`inline-flex h-full shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium ${toolbarControlClass} ${isActive('/transactions') ? '!bg-blue-50 !text-blue-600 hover:!bg-blue-50' : ''}`}
					href={resolve('/transactions')}
					aria-current={isActive('/transactions') ? 'page' : undefined}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5" aria-hidden="true">
						<path d="M7 7h11l-3-3" /><path d="m18 7-3 3" /><path d="M17 17H6l3 3" /><path d="m6 17 3-3" /><path d="M5 7h2" /><path d="M17 17h2" />
					</svg>
					<span>{m.nav_transactions()}</span>
				</a>
				<a
					class={`inline-flex h-full shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium ${toolbarControlClass} ${isActive('/review') ? '!bg-blue-50 !text-blue-600 hover:!bg-blue-50' : ''}`}
					href={resolve('/review')}
					aria-current={isActive('/review') ? 'page' : undefined}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5" aria-hidden="true">
						<path d="M12 3 4 6v5c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-3Z" /><path d="m9 12 2 2 4-4" />
					</svg>
					<span>{m.nav_review()}</span>
				</a>
				<a
					class={`inline-flex h-full shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium ${toolbarControlClass} ${isActive('/planning') ? '!bg-blue-50 !text-blue-600 hover:!bg-blue-50' : ''}`}
					href={resolve('/planning')}
					aria-current={isActive('/planning') ? 'page' : undefined}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5" aria-hidden="true">
						<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4V2" /><path d="M12 22v-2" /><path d="m19.07 4.93-1.42 1.42" /><path d="m6.35 17.65-1.42 1.42" />
					</svg>
					<span>{m.nav_planning()}</span>
				</a>
			</nav>

			<div class="relative hidden h-11 w-11 min-[950px]:col-start-1 min-[950px]:row-start-1 min-[950px]:block min-[950px]:justify-self-start">
				<button
					class={`flex h-full w-full items-center justify-center ${toolbarControlClass}`}
					type="button"
					aria-label={m.toolbar_menu()}
					aria-expanded={menuOpen}
					aria-controls="desktop-menu"
					title={m.toolbar_menu()}
					onclick={() => (menuOpen = !menuOpen)}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="size-6" aria-hidden="true">
						<path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
					</svg>
				</button>
				{#if menuOpen}
					<section
						id="desktop-menu"
						class="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-ui border border-zinc-200 bg-white p-4"
					>
						<p class="px-2 text-sm font-medium text-zinc-700">{m.switch_language()}</p>
						<div class="mt-4 flex items-center justify-between gap-3 px-2">
							<span class={`text-sm font-medium ${currentLocale === 'en' ? 'text-blue-600' : 'text-zinc-500'}`}>{m.language_english()}</span>
							<button
								class={`relative h-7 w-12 rounded-full transition-colors ${currentLocale === 'de' ? 'bg-blue-600' : 'bg-zinc-300'}`}
								type="button"
								role="switch"
								aria-label={m.switch_language()}
								aria-checked={currentLocale === 'de'}
								onclick={() => switchLanguage(currentLocale === 'de' ? 'en' : 'de')}
							>
								<span class={`absolute top-1 size-5 rounded-full bg-white transition-transform ${currentLocale === 'de' ? 'translate-x-6' : 'translate-x-1'}`}></span>
							</button>
							<span class={`text-sm font-medium ${currentLocale === 'de' ? 'text-blue-600' : 'text-zinc-500'}`}>{m.language_german()}</span>
						</div>
					</section>
				{/if}
			</div>
			<div class="hidden h-11 w-11 min-[950px]:col-start-3 min-[950px]:row-start-1 min-[950px]:block" aria-hidden="true"></div>

			<div class="col-span-3 grid grid-cols-[4rem_minmax(0,1fr)_4rem] items-center gap-2 min-[950px]:hidden">
				<div class="relative col-start-1 h-11 w-11 justify-self-start">
					<button
					class="flex h-full w-full items-center justify-center rounded-full border border-zinc-200 bg-white/95 text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950"
					type="button"
					aria-label={m.toolbar_menu()}
					aria-expanded={menuOpen}
					aria-controls="mobile-menu"
						onclick={() => {
							menuOpen = !menuOpen;
							mobileNavigationOpen = false;
						}}
					>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="size-6" aria-hidden="true">
							<path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
						</svg>
					</button>
					{#if menuOpen}
						<section
							id="mobile-menu"
							class="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-ui border border-zinc-200 bg-white p-4"
						>
							<p class="px-2 text-sm font-medium text-zinc-700">{m.switch_language()}</p>
							<div class="mt-4 flex items-center justify-between gap-3 px-2">
								<span class={`text-sm font-medium ${currentLocale === 'en' ? 'text-blue-600' : 'text-zinc-500'}`}>{m.language_english()}</span>
								<button
									class={`relative h-7 w-12 rounded-full transition-colors ${currentLocale === 'de' ? 'bg-blue-600' : 'bg-zinc-300'}`}
									type="button"
									role="switch"
									aria-label={m.switch_language()}
									aria-checked={currentLocale === 'de'}
									onclick={() => switchLanguage(currentLocale === 'de' ? 'en' : 'de')}
								>
									<span class={`absolute top-1 size-5 rounded-full bg-white transition-transform ${currentLocale === 'de' ? 'translate-x-6' : 'translate-x-1'}`}></span>
								</button>
								<span class={`text-sm font-medium ${currentLocale === 'de' ? 'text-blue-600' : 'text-zinc-500'}`}>{m.language_german()}</span>
							</div>
						</section>
					{/if}
				</div>
				<div class="relative col-start-2 w-fit max-w-full justify-self-center">
					<button
						class="flex h-11 w-fit max-w-full items-center gap-3 rounded-full border border-zinc-200 bg-white/95 px-5 text-left text-blue-600 transition-colors hover:bg-zinc-50"
						type="button"
						aria-label={m.primary_navigation()}
						aria-expanded={mobileNavigationOpen}
						aria-controls="mobile-navigation-picker"
						onclick={() => {
							mobileNavigationOpen = !mobileNavigationOpen;
							menuOpen = false;
						}}
					>
					{#if activePath() === '/'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
							<path d="M4 19v-5" /><path d="M8 19V8" /><path d="M12 19v-9" /><path d="M16 19V4" /><path d="M20 19v-7" />
						</svg>
					{:else if activePath() === '/accounts'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
							<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8" /><path d="M3 10l18 0" /><path d="M7 15l.01 0" /><path d="M11 15l2 0" />
						</svg>
					{:else if activePath() === '/imports'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
							<path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M5 20h14" /><path d="M5 20v-3" /><path d="M19 20v-3" />
						</svg>
					{:else if activePath() === '/transactions'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
							<path d="M7 7h11l-3-3" /><path d="m18 7-3 3" /><path d="M17 17H6l3 3" /><path d="m6 17 3-3" /><path d="M5 7h2" /><path d="M17 17h2" />
						</svg>
					{:else if activePath() === '/review'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
							<path d="M12 3 4 6v5c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-3Z" /><path d="m9 12 2 2 4-4" />
						</svg>
					{:else}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
							<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4V2" /><path d="M12 22v-2" /><path d="m19.07 4.93-1.42 1.42" /><path d="m6.35 17.65-1.42 1.42" />
						</svg>
					{/if}
					<span class="truncate text-base font-medium">{activeLabel()}</span>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto size-5 shrink-0" aria-hidden="true">
						<path d={mobileNavigationOpen ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
					</svg>
					</button>

					{#if mobileNavigationOpen}
						<nav
							id="mobile-navigation-picker"
							class="absolute left-1/2 top-[calc(100%+0.5rem)] z-40 w-max min-w-[18rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-ui border border-zinc-200 bg-white p-4"
							aria-label={m.primary_navigation()}
						>
							<a
								class={`flex h-11 items-center gap-4 rounded-ui px-5 text-base font-medium ${isActive('/') ? 'bg-blue-50 text-blue-600' : 'text-zinc-700 hover:bg-zinc-50'}`}
								href={resolve('/')}
								onclick={() => (mobileNavigationOpen = false)}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
									<path d="M4 19v-5" /><path d="M8 19V8" /><path d="M12 19v-9" /><path d="M16 19V4" /><path d="M20 19v-7" />
								</svg>
								<span>{m.nav_dashboard()}</span>
							</a>
							<div class="mx-3 my-2 h-px bg-zinc-100" aria-hidden="true"></div>
							<a
								class={`flex h-11 items-center gap-4 rounded-ui px-5 text-base font-medium ${isActive('/accounts') ? 'bg-blue-50 text-blue-600' : 'text-zinc-700 hover:bg-zinc-50'}`}
								href={resolve('/accounts')}
								onclick={() => (mobileNavigationOpen = false)}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
									<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8" /><path d="M3 10l18 0" /><path d="M7 15l.01 0" /><path d="M11 15l2 0" />
								</svg>
								<span>{m.nav_accounts()}</span>
							</a>
							<div class="mx-3 my-2 h-px bg-zinc-100" aria-hidden="true"></div>
							<a
								class={`flex h-11 items-center gap-4 rounded-ui px-5 text-base font-medium ${isActive('/imports') ? 'bg-blue-50 text-blue-600' : 'text-zinc-700 hover:bg-zinc-50'}`}
								href={resolve('/imports')}
								onclick={() => (mobileNavigationOpen = false)}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
									<path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M5 20h14" /><path d="M5 20v-3" /><path d="M19 20v-3" />
								</svg>
								<span>{m.nav_imports()}</span>
							</a>
							<div class="mx-3 my-2 h-px bg-zinc-100" aria-hidden="true"></div>
							<a
								class={`flex h-11 items-center gap-4 rounded-ui px-5 text-base font-medium ${isActive('/transactions') ? 'bg-blue-50 text-blue-600' : 'text-zinc-700 hover:bg-zinc-50'}`}
								href={resolve('/transactions')}
								onclick={() => (mobileNavigationOpen = false)}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
									<path d="M7 7h11l-3-3" /><path d="m18 7-3 3" /><path d="M17 17H6l3 3" /><path d="m6 17 3-3" /><path d="M5 7h2" /><path d="M17 17h2" />
								</svg>
								<span>{m.nav_transactions()}</span>
							</a>
							<div class="mx-3 my-2 h-px bg-zinc-100" aria-hidden="true"></div>
							<a
								class={`flex h-11 items-center gap-4 rounded-ui px-5 text-base font-medium ${isActive('/review') ? 'bg-blue-50 text-blue-600' : 'text-zinc-700 hover:bg-zinc-50'}`}
								href={resolve('/review')}
								onclick={() => (mobileNavigationOpen = false)}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
									<path d="M12 3 4 6v5c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-3Z" /><path d="m9 12 2 2 4-4" />
								</svg>
								<span>{m.nav_review()}</span>
							</a>
							<div class="mx-3 my-2 h-px bg-zinc-100" aria-hidden="true"></div>
							<a
								class={`flex h-11 items-center gap-4 rounded-ui px-5 text-base font-medium ${isActive('/planning') ? 'bg-blue-50 text-blue-600' : 'text-zinc-700 hover:bg-zinc-50'}`}
								href={resolve('/planning')}
								onclick={() => (mobileNavigationOpen = false)}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6 shrink-0" aria-hidden="true">
									<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4V2" /><path d="M12 22v-2" /><path d="m19.07 4.93-1.42 1.42" /><path d="m6.35 17.65-1.42 1.42" />
								</svg>
								<span>{m.nav_planning()}</span>
							</a>
						</nav>
					{/if}
				</div>
				<div class="col-start-3 h-11 w-11" aria-hidden="true"></div>
			</div>
		</div>
	</header>
	{@render children()}
</div>
