export function getDateRange(dates: string[]): {
	startDate: string | null;
	endDate: string | null;
} {
	if (dates.length === 0) {
		return { startDate: null, endDate: null };
	}

	const sorted = [...dates].sort();
	return {
		startDate: sorted[0] ?? null,
		endDate: sorted.at(-1) ?? null
	};
}

export async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest('SHA-256', bytes);

	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
