ALTER TABLE transactions ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'
	CHECK (kind IN ('standard', 'combined_import'));

ALTER TABLE import_batches ADD COLUMN combine_before_date TEXT;
ALTER TABLE import_batches ADD COLUMN combined_source_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN combined_record_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN detailed_import_count INTEGER NOT NULL DEFAULT 0;

UPDATE import_batches SET detailed_import_count = imported_count;

CREATE TABLE import_source_fingerprints (
	account_id TEXT NOT NULL,
	import_batch_id TEXT NOT NULL,
	dedupe_key TEXT NOT NULL,
	PRIMARY KEY (account_id, dedupe_key),
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
	FOREIGN KEY (import_batch_id) REFERENCES import_batches (id) ON DELETE CASCADE
);

CREATE INDEX idx_import_source_fingerprints_batch
	ON import_source_fingerprints (import_batch_id);
