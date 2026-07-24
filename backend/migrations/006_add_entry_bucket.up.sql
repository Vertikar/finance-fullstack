-- Entries gain an optional per-entry bucket override, symmetric with the
-- per-transaction override. NULL means "inherit the category's default bucket"
-- (effective bucket = COALESCE(entries.bucket, categories.bucket)); a value
-- places this entry in a bucket that may differ from its category's default.
ALTER TABLE entries ADD COLUMN bucket TEXT
    CHECK (bucket IN ('income','living','lifestyle','goals'));
