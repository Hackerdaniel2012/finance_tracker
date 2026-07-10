PRAGMA foreign_keys = ON;

ALTER TABLE transactions ADD COLUMN subaccount TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_account_subaccount
ON transactions (account_id, subaccount);
