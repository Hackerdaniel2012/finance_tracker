export async function fetchJsonWithRetry<T = unknown>(url: string, init?: RequestInit): Promise<T> {
	const isSafeRead = !init?.method || init.method.toUpperCase() === 'GET';
	const delays = isSafeRead ? [0, 120, 300] : [0];
	let lastError: Error | null = null;
	for (const delay of delays) {
		if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
		const response = await fetch(url, init);
		if (response.ok) return (await response.json()) as T;
		lastError = new Error(await response.text());
		if (response.status !== 503) break;
	}
	throw lastError ?? new Error('Request failed');
}
