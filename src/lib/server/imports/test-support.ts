import type { BankId } from '$lib/banks';
import type { DbClient } from '../db-client';
import { confirmImport } from './confirm';
import { previewImport } from './preview';
import { sha256Hex } from './shared';

/** Compatibility helper for tests whose subject is not the import workflow. */
export async function importIntoExistingAccount(
	db: DbClient,
	input: {
		accountId: string;
		adapterId: BankId;
		csv: string;
		reportedBalanceCents: number;
		expectedHash?: string;
	}
) {
	const discovery = await previewImport(db, { adapterId: input.adapterId, csv: input.csv });
	const assignments = discovery.accounts.map((group, index) =>
		index === 0
			? {
					sourceAccountKey: group.sourceAccountKey,
					targetAccountId: input.accountId,
					balanceMode: 'reported' as const,
					reportedBalanceCents: input.reportedBalanceCents
				}
			: {
					sourceAccountKey: group.sourceAccountKey,
					newAccount: { name: group.sourceAccountLabel, institution: null },
					balanceMode: 'complete_history' as const
				}
	);
	const checked = await previewImport(db, {
		adapterId: input.adapterId,
		csv: input.csv,
		assignments
	});
	const report = await confirmImport(db, {
		adapterId: input.adapterId,
		csv: input.csv,
		expectedHash: input.expectedHash ?? (await sha256Hex(input.csv)),
		expectedConfigurationHash: checked.configurationHash!,
		assignments
	});
	return {
		...report,
		batchId: report.accounts[0].batchId,
		accountId: report.accounts[0].accountId
	};
}
