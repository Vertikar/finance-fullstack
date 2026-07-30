-- Transaction import machinery: raw bank rows are stored permanently so that
-- recurring-entry detection (next phase) and a future actual-vs-budget ledger
-- can both read from the same source of truth.

-- A saved column mapping for one export format. user_id IS NULL marks a
-- built-in, globally available preset (read-only); a non-NULL user_id is a
-- user's own saved mapping.
CREATE TABLE import_sources (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    column_map JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Built-in preset labels are unique; per-user labels are not constrained here.
CREATE UNIQUE INDEX idx_import_sources_global_label
    ON import_sources(label) WHERE user_id IS NULL;

-- One upload. Deleting a batch cascades to the transactions it created, which
-- is what makes "undo this import" possible.
CREATE TABLE import_batches (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id   UUID REFERENCES import_sources(id),
    filename    TEXT,
    row_count   INT NOT NULL DEFAULT 0,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_batches_user_id ON import_batches(user_id);

CREATE TABLE transactions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    import_batch_id  UUID REFERENCES import_batches(id) ON DELETE CASCADE,
    -- Source's own transaction id when it has one, otherwise a computed hash of
    -- (date, amount, normalized description, account) so re-importing an
    -- overlapping export dedupes instead of duplicating.
    external_id      TEXT,
    description      TEXT NOT NULL,
    amount           NUMERIC(12,2) NOT NULL,  -- signed: negative = money out
    currency         TEXT NOT NULL DEFAULT 'AUD',
    transaction_date DATE NOT NULL,
    account_name     TEXT,
    provider_name    TEXT,
    category_raw     TEXT,                    -- the source's own category label
    bucket_raw       TEXT,                    -- the source's own bucket, when present
    -- The app category assigned at review. Free-text (no FK) to match
    -- entries.category; the future category admin page can tighten both.
    category         TEXT,
    -- Per-transaction bucket override; NULL = inherit the category's default.
    -- Effective bucket = COALESCE(transactions.bucket, categories.bucket).
    bucket           TEXT CHECK (bucket IN ('income','living','lifestyle','goals')),
    transaction_type TEXT,
    included         BOOLEAN NOT NULL DEFAULT TRUE,
    matched_entry_id UUID REFERENCES entries(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup key. Partial so rows without an external_id are never blocked.
CREATE UNIQUE INDEX idx_transactions_external_id
    ON transactions(user_id, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX idx_transactions_user_date ON transactions(user_id, transaction_date);

-- Built-in Frollo preset. Keep in sync with importer.FrolloPreset (a test
-- asserts the two match). Additional bank presets are added as their real
-- export layouts are confirmed.
INSERT INTO import_sources (user_id, label, column_map) VALUES (
    NULL,
    'Frollo',
    '{
        "has_header": true,
        "date_format": "YYYY-MM-DD",
        "amount_mode": "signed",
        "detect": ["description", "amount", "budget_category", "category_name"],
        "columns": {
            "external_id": "transaction_id",
            "transaction_date": "transaction_date",
            "description": "description",
            "amount": "amount",
            "currency": "currency",
            "account_name": "account_name",
            "provider_name": "provider_name",
            "category_raw": "category_name",
            "bucket_raw": "budget_category",
            "transaction_type": "transaction_type",
            "included": "included"
        },
        "category_aliases": {
            "Groceries": "Food & Groceries",
            "Healthcare/Medical": "Health",
            "Mortgage": "Housing",
            "Clothing/Shoes": "Clothing",
            "Subscriptions/Renewals": "Subscriptions",
            "Entertainment/Recreation": "Entertainment",
            "Salary/Regular Income": "Salary",
            "Interest Income": "Investment"
        }
    }'::jsonb
) ON CONFLICT DO NOTHING;
