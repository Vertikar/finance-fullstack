-- Reverse dependency order: transactions references import_batches, which
-- references import_sources.
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS import_batches;
DROP TABLE IF EXISTS import_sources;
