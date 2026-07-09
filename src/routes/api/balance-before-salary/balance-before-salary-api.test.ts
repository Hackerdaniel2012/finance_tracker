import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { createPlannedIncome, createPlannedPayment } from '$lib/server/planned-cashflow/repository';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/balance-before-salary', () => {
	it('returns projected balance before the next planned income', async () => {
		const account = await createAccount(db, { name: 'Main Giro', currentBalanceCents: 150000 });
		await createPlannedPayment(db, {
			accountId: account.id,
			payee: 'Rent',
			amountCents: 80000,
			dueDate: '2026-07-20'
		});
		await createPlannedIncome(db, {
			accountId: account.id,
			payer: 'Employer',
			amountCents: 250000,
			dueDate: '2026-07-25'
		});

		const response = await GET(event('http://localhost/api/balance-before-salary?asOf=2026-07-08'));

		await expect(response.json()).resolves.toMatchObject({
			projection: {
				projectionDate: '2026-07-24',
				currentBalanceCents: 150000,
				upcomingPaymentCents: 80000,
				projectedBalanceCents: 70000,
				nextIncome: { payer: 'Employer' },
				accountProjections: [
					{
						accountId: account.id,
						accountName: 'Main Giro',
						currentBalanceCents: 150000,
						upcomingPaymentCents: 80000,
						projectedBalanceCents: 70000
					}
				]
			}
		});
	});

	it('uses an explicit manual next salary date override', async () => {
		const account = await createAccount(db, { name: 'Main Giro', currentBalanceCents: 150000 });
		await createPlannedPayment(db, {
			accountId: account.id,
			payee: 'Power',
			amountCents: 10000,
			dueDate: '2026-07-10'
		});
		await createPlannedPayment(db, {
			accountId: account.id,
			payee: 'Rent',
			amountCents: 80000,
			dueDate: '2026-07-20'
		});
		await createPlannedIncome(db, {
			accountId: account.id,
			payer: 'Employer',
			amountCents: 250000,
			dueDate: '2026-07-25'
		});

		const response = await GET(
			event('http://localhost/api/balance-before-salary?asOf=2026-07-08&nextSalaryDate=2026-07-18')
		);

		await expect(response.json()).resolves.toMatchObject({
			projection: {
				projectionDate: '2026-07-17',
				manualNextSalaryDate: '2026-07-18',
				currentBalanceCents: 150000,
				upcomingPaymentCents: 10000,
				projectedBalanceCents: 140000,
				nextIncome: { payer: 'Employer' }
			}
		});
	});

	it('returns validation errors for invalid manual next salary dates', async () => {
		const malformed = await GET(
			event('http://localhost/api/balance-before-salary?asOf=2026-07-08&nextSalaryDate=bad')
		);
		expect(malformed.status).toBe(400);
		await expect(malformed.json()).resolves.toEqual({
			error: 'nextSalaryDate must be an ISO date'
		});

		const past = await GET(
			event('http://localhost/api/balance-before-salary?asOf=2026-07-08&nextSalaryDate=2026-07-08')
		);
		expect(past.status).toBe(400);
		await expect(past.json()).resolves.toEqual({
			error: 'nextSalaryDate must be after asOf'
		});
	});
});

function event(url: string) {
	return {
		platform: { env: { DB: db } },
		url: new URL(url)
	} as Parameters<typeof GET>[0];
}
