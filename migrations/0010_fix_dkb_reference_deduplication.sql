UPDATE transactions
SET dedupe_key =
	'dkb_ref:' || dedupe_key || '|' || booking_date || '|' || COALESCE(value_date, '') || '|' || amount_cents
WHERE import_batch_id IN (
	SELECT id
	FROM import_batches
	WHERE adapter_id = 'dkb_girocard'
)
	AND substr(dedupe_key, 1, 3) <> 'fp_'
	AND substr(dedupe_key, 1, 8) <> 'dkb_ref:';
