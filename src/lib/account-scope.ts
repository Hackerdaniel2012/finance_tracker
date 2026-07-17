export interface AccountScopeAccount {
	id: string;
	name: string;
}

export interface AccountScopeOption {
	value: string;
	label: string;
}

export function buildAccountScopeOptions(accounts: AccountScopeAccount[]): AccountScopeOption[] {
	return accounts.map((account) => ({ value: account.id, label: account.name }));
}

export function parseAccountScope(value: string): { accountId: string } {
	return { accountId: value };
}

export function buildAccountScopeQuery(value: string): string {
	const { accountId } = parseAccountScope(value);
	const params = new URLSearchParams();
	params.set('accountId', accountId);

	return `?${params.toString()}`;
}
