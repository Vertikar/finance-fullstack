DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS users;

-- The entries_updated_at trigger goes with the table above, but the function it
-- calls does not — without this it survives a full rollback and leaks into the
-- next migration run.
DROP FUNCTION IF EXISTS update_updated_at();

DROP EXTENSION IF EXISTS "uuid-ossp";
