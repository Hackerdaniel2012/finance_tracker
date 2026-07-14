import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getBalanceBeforeIncomeProjection } from '$lib/server/cashflow/repository';
import { parseCashflowWindow } from '$lib/server/cashflow/validation';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) => { try { return json({ projection: await getBalanceBeforeIncomeProjection(getRequestDatabase(event), parseCashflowWindow(event.url)) }); } catch (error) { return jsonError(error); } };
