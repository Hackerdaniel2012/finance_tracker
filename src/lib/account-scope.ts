export interface AccountScopeAccount {
	id: string;
	name: string;
	subaccounts: string[];
}

export interface AccountScopeOption {
	value: string;
	label: string;
}

export function buildAccountScopeOptions(accounts: AccountScopeAccount[]): AccountScopeOption[] {
	const options: AccountScopeOption[] = [];

	for (const account of accounts) {
		if (account.subaccounts.length > 0) {
			options.push({ value: account.id, label: `${account.name} - All` });
			for (const subaccount of account.subaccounts) {
				options.push({
					value: `${account.id}:${encodeURIComponent(subaccount)}`,
					label: `${account.name} - ${subaccount}`
				});
			}
		} else {
			options.push({ value: account.id, label: account.name });
		}
	}

	return options;
}

export function parseAccountScope(value: string): { accountId: string; subaccount?: string } {
	const separatorIndex = value.indexOf(':');
	if (separatorIndex === -1) {
		return { accountId: value };
	}

	return {
		accountId: value.slice(0, separatorIndex),
		subaccount: decodeURIComponent(value.slice(separatorIndex + 1))
	};
}

export function buildAccountScopeQuery(value: string): string {
	const { accountId, subaccount } = parseAccountScope(value);
	const params = new URLSearchParams();
	params.set('accountId', accountId);
	if (subaccount) {
		params.set('subaccount', subaccount);
	}

	return `?${params.toString()}`;
}
