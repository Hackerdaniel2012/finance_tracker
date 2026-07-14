UPDATE transactions
SET dedupe_key = dedupe_key || ':1'
WHERE import_batch_id IN (
	SELECT id
	FROM import_batches
	WHERE adapter_id = 'dkb_creditcard'
)
	AND dedupe_key GLOB 'fp_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]';
