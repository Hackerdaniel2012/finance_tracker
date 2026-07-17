import type { DbClient } from '../db-client';
import { prepareImport } from './preparation';
import type { ImportPreview, ImportPreviewInput } from './types';

export async function previewImport(
	db: DbClient,
	input: ImportPreviewInput
): Promise<ImportPreview> {
	return (await prepareImport(db, input)).preview;
}
