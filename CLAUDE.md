# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the app

```bash
make up          # build and start all services (http://localhost:8080)
make down        # stop all services
make logs-api    # tail API logs
make db-version  # show the applied migration version and dirty flag
make backup      # dump to backup_YYYYMMDD_HHMMSS.dump (pg_dump custom format)
make restore FILE=<path>  # ⚠️ replaces the ENTIRE database with the backup
make reset-db    # ⚠️ DESTRUCTIVE — wipes postgres volume and restarts
```

`make backup` / `make restore` read the database user and name from the `db` container's
own `POSTGRES_USER` / `POSTGRES_DB` (set by docker-compose from `.env`), so they can't
drift from the values the database was created with. Override per invocation with
`make psql DB_USER=other DB_NAME=otherdb`.

`backup` writes pg_dump's custom format (`-Fc`). `restore` accepts that and the older plain
`.sql` dumps, and **validates the whole file before dropping anything** — custom archives by
decoding them (`pg_restore -f /dev/null`; `pg_restore -l` only reads the header and passes on
a truncated archive), plain SQL by requiring pg_dump's end-of-dump trailer. Truncation is not
a SQL error, so `ON_ERROR_STOP` alone does not catch it: psql hits EOF, exits 0 and commits a
half-restored database. After validation the load runs in a single transaction.

`restore` drops schema `public` first because loading a dump into a populated database
silently half-restores it: pg_dump emits `COPY` in alphabetical order, so `entries` and
`budgets` are rejected by their foreign keys before `users` has been loaded.

The pre-flight also compares the dump's own `schema_migrations` version against
`backend/migrations/`, which is what the API binary embeds, and **refuses a dump that is
ahead** — see below.

`FORCE=1` skips the confirmation delay and downgrades the version check to a warning. It
does not bypass the truncation check.

### Migration version drift

The `postgres_data` volume outlives branch switches. Running a branch with a newer
migration set and then switching back leaves the database ahead of the API binary, and the
API crash-loops with `no migration found for version N: read down ... file does not exist`
— which means "the database is ahead of this build", not "a file is missing". `make
db-version` is the first diagnostic; `make reset-db` is the blunt (destructive) fix.

Backups include `schema_migrations`, so restoring a dump taken on a branch with newer
migrations reintroduces the same drift. `make restore` now detects this before it drops
anything and refuses, naming both versions — override with `FORCE=1` if you intend to switch
to the branch carrying that migration.

To roll a database back by hand when it is already ahead, run the newer migration's
`.down.sql` statements and then `UPDATE schema_migrations SET version = <n>, dirty = false;`.
This is preferable to `make reset-db`, which destroys the data.

### Tests

```bash
# Local (requires Go 1.22+ and Node 20+)
make test                   # both suites in CI mode
make test-backend           # go test ./... -v
make test-backend-coverage  # + HTML report at backend/coverage.html
make test-migrations        # migration checks incl. the round trip (needs a Postgres)
make test-frontend-ci       # react-scripts test --watchAll=false --coverage
make test-frontend          # watch mode

# Docker (no local runtime needed)
make test-docker            # both suites
make test-docker-backend    # Go only
make test-docker-frontend   # React/Jest only
```

To run a single Go test:
```bash
cd backend && go test ./handlers/ -run TestLogin -v
```

To run a single Jest test file:
```bash
cd frontend && npx react-scripts test utils.test.js --watchAll=false
```

### Migration checks

`backend/migrations_static_test.go` enforces the hygiene rules on every run, no database
needed: three-digit filenames (`^\d{3}_[a-z0-9_]+\.(up|down)\.sql$`), an up **and** a down
for every version, no version claimed twice, versions contiguous from `001`, and both
directions readable through the same `iofs` driver the API uses.

`backend/migrations_roundtrip_test.go` walks the set up one version at a time recording the
schema at each step, walks back down comparing each step against what it recorded, then
re-applies the whole set and compares against the first pass. Stepping is the point —
rolling straight down to zero hides an incomplete down, because `001`'s down drops the
tables outright and the re-up then looks identical.

It needs a Postgres and skips without one, so `make test-backend` and the Docker test image
stay green offline:

```bash
MIGRATE_TEST_DATABASE_URL='postgres://user:pass@localhost:5432/postgres?sslmode=disable' \
  go test . -count=1 -run TestMigration -v
```

The database named there is never migrated — the test creates a uniquely-named throwaway
and drops it afterwards. CI sets `MIGRATE_TEST_REQUIRE_DB=1` alongside the URL so a broken
service container fails the build instead of silently skipping the check.

## Architecture

**Stack:** Go 1.22 API → PostgreSQL 16, served behind nginx which proxies `/api/*` to the Go backend and serves the React SPA for everything else. All orchestrated with Docker Compose.

### Backend (`backend/`)

- `main.go` — chi router setup, migration runner, JWT secret validation at startup. Handlers are struct types with a `DB *sql.DB` field; the JWT secret is passed explicitly, no handler reads `os.Getenv` directly.
- `db/db.go` — postgres connection pool with retry loop.
- `handlers/auth.go` — `POST /api/auth/register` and `POST /api/auth/login`, bcrypt passwords, returns JWT.
- `handlers/entries.go` — full CRUD for `Entry` records plus `GET /api/entries/summary` which computes monthly-equivalent totals using `freqMultiplier`. All routes are user-scoped via `mw.GetUserID(r)`.
- `handlers/import_export.go` — `GET /api/entries/export` (CSV download) and `POST /api/entries/import` (multipart CSV upload).
- `handlers/transactions_import.go` — `POST /api/transactions/import`, ingests raw bank-statement CSVs into `transactions`. Resolves a column mapping (inline `column_map` → `source_id` → auto-detect from the header), inserts the batch and its rows in one transaction, and treats re-imported rows as duplicates via `ON CONFLICT` on `(user_id, external_id)`.
- `importer/` — pure CSV-mapping logic with no HTTP or DB dependencies: `ColumnMap`/`MapRow`, preset auto-detection, description normalisation, the `external_id` dedup hash, and date/amount parsing. Kept separate so it is unit-testable directly and reusable by the upcoming recurring-detection phase.
- `handlers/settings.go` — `GET/PUT /api/settings/pay-cycle` for per-user pay cycle preferences.
- `middleware/auth.go` — JWT validation middleware; exposes `GetUserID(r)` to extract the claim.
- `migrations/` — embedded into the binary via `//go:embed`; applied automatically on startup using `golang-migrate`. Files follow `{NNN}_{title}.{up|down}.sql` naming — three digits, lower_snake_case title, both directions required. CI enforces this (see **Migration checks**).

**Key dependency note:** `go.mod` has `replace` directives that mirror `golang.org/x/*` packages to `github.com/golang/*` mirrors. Don't remove these.

### Frontend (`frontend/src/`)

- `App.js` — single-file component containing the entire dashboard: Overview, Payments, Cash Flow, and Pay Cycle tabs. Also holds `FREQ_META`, `CATEGORIES`, and `CAT_COLORS` constants used throughout.
- `api.js` — typed fetch wrapper. All API calls go through `request()`. Token stored in `localStorage` as `finance_token`. `exportEntries` and `importEntries` use raw `fetch` (not the `request` helper) because they handle non-JSON content types.
- `utils.js` — pure financial functions: `toMonthly`, `addFreq`, `buildCashFlow`. No React dependencies — easy to unit test.
- `AuthScreen.js` — login/register form shown when no token is present.
- `ImportModal.js` — CSV import dialog component.
- `PayCycle.js` — pay cycle budgeting tab component.
- `themes.js` — theme definitions and icon components.

### Data model

`Entry` has: `id` (uuid), `name`, `amount`, `type` (`income`|`expense`), `frequency` (one of 6 values), `category`, `bucket` (optional per-entry override; `null` = inherit the category's default bucket), `nextDue` (date string).

All six frequencies are enforced by a DB constraint and mirrored in `freqMultiplier` (Go) and `FREQ_META` (JS). When adding a new frequency, update both, the DB constraint (new migration), and `utils.js`.

### Testing patterns

Go tests use `go-sqlmock` to mock the database — tests instantiate handler structs directly without starting a server. Frontend tests use `@testing-library/react` with `fetch` mocked via `jest.fn()` in each test file. New features must have accompanying tests (see memory).

## Branch naming

Name branches for humans: use a `type/short-description` slug with a hyphenated, descriptive
name and a type prefix — `feature/`, `fix/`, `docs/`, `chore/`, `refactor/`, or `test/`.
Examples: `feature/add-paycycle`, `fix/broken-rendering`, `docs/branch-naming-convention`.
Avoid opaque, auto-generated branch names.

## Pull request conventions

Every PR opened for this repo **must include a `## Testing & follow-up` checklist** in
its description (GitHub markdown `- [ ]` task items). Tailor the items to the change, and
always cover at least:

- **Automated tests / CI** — backend `go test ./...`, frontend Jest suite, and `npm run build`
  (note which passed locally and which CI jobs must go green).
- **Manual end-to-end verification** — the concrete steps to exercise the change in the running app.
- **DB migrations** — when the PR adds a migration, confirm it applies on a fresh DB and that
  the `.down.sql` rolls back cleanly (`make reset-db`).
- **Follow-ups / out of scope** — known deferred work or limitations so reviewers can track them.

Every follow-up / out-of-scope item from a PR must be tracked in **both places**: the PR body
(under `## Testing & follow-up`) **and** the root [`TODO.md`](./TODO.md). `TODO.md` uses the
[todo.md](https://github.com/todomd/todo.md) format — `### Todo` / `### In Progress` / `### Done ✓`
columns with `- [ ]` / `- [x]` items. Tag each item with its originating PR (e.g. `#pr-19`) and an
area tag (e.g. `#frontend`, `#backend`). Move items to `### Done ✓` (check the box) when shipped.

## Project status & plan

> **Maintained section** — update this whenever a PR merges, a feature is scoped, or
> priorities change. Last updated: **2026-07-27**.

### Current state

- `main` is green through **migration 006**. Recent merges: **#25** (Go module rename to
  `github.com/vertikar/finance-api`), **#27** (v2.1 scope doc under `docs/`), **#26**
  (DB-backed categories with buckets — migration 005 `categories` table + seed,
  `GET /api/categories`, frontend fetch with constant fallback, Overview bucket card + Payments
  bucket filter, plus migration 006 `entries.bucket` per-entry override), **#30** (bank-statement
  hint in the entries importer), and **#33/#34** (backup/restore hardening + migration-drift
  guard — see "Migration version drift" above).
- **PR #23 open** — `test: expand backend and frontend coverage for error paths and untested
  logic` (branch `claude/test-coverage-analysis-ggvi5h`). No production behaviour changes
  except a `validateJWTSecret()` testability refactor in `main.go`. **Awaiting Henrik's manual
  test on the local deployment, then merge.**
- **PR #28 open** — `feat: transactions schema and bank-CSV import` (branch
  `feature/transactions-schema-and-import`). Migration 007 (`import_sources`, `import_batches`,
  `transactions`), the `importer/` mapping package, and `POST /api/transactions/import` with
  hash-based dedup. Backend-only; Frollo preset only (see the scope doc §7 for why the other five
  are deferred). Migration and the full import/dedup flow verified against a real Postgres.
- **PR #29 open** — `chore: add Bruno collection for manual API testing` (branch
  `chore/bruno-api-collection`). Tooling only, under `bruno/`; no application code.
- Follow-ups from merged PRs live in `TODO.md` (PRs #19/#20, #26's bucket/admin items, #30's
  hint upgrade, #33/#34's backup items, plus #28's deferred bank presets).

### Next feature: transaction import, recurring detection & buckets

Fully scoped (see [`docs/transaction-import-feature-scope.md`](./docs/transaction-import-feature-scope.md), v2.1). Summary: import raw
bank-transaction CSVs, detect recurring merchant+amount+interval patterns, and let the user
approve them into `entries`. Validated against a real 3,112-row Frollo export — detection
cleanly identifies mortgage (fortnightly, stdev 0.3d), Telstra, Disney+, RACV, AWS, etc.

Key decisions (agreed 2026-07-23):

1. **Phased**: transactions stored permanently now (ledger/reconciliation UI is Phase 2);
   `transactions.matched_entry_id` makes Phase 2 additive.
2. **Generic column-mapper** with presets: Frollo (richest — has category + bucket + external
   ID), plus raw CSVs from CommBank, Up, ubank, ING Direct, AustralianSuper. Verify each
   bank's real export layout during implementation. Hash-based `external_id` dedup for banks
   without transaction IDs.
3. **Categories become DB-backed** (`categories` table, seeded with existing 18 + ~28 new
   categories adopted from the Frollo taxonomy). `CATEGORIES`/`CAT_COLORS` constants in
   `App.js` are replaced by `GET /api/categories`.
4. **Buckets**: Frollo's `budget_category` (income/living/lifestyle/goals) becomes a
   first-class grouping — a `bucket` column on `categories`; entries inherit bucket via
   category. Phase 1 UI: bucket breakdown card on Overview + bucket filter on Payments.
5. **All transfers excluded from detection and income** — including recurring
   third-party transfers (e.g. the fortnightly mortgage contribution transfer); they are
   money movement, not income.
6. Round-ups, interest, fees, `included=false` rows excluded from detection ($2 amount floor).
7. Detection confidence threshold defaults to 0.5, exposed as a slider in review UI;
   tune the default after the first real import.

Planned branches, in order (each with its own PR):

1. `feature/categories-and-buckets` — migration 005 (categories + bucket column + seed),
   `GET /api/categories`, frontend fetch + bucket card/filter, plus migration 006
   (`entries.bucket` override). **→ PR #26, merged.**
2. `feature/transactions-schema-and-import` — migration 007 (import_sources, import_batches,
   transactions), `importer/` mapper engine + Frollo preset + fixture, import/dedup endpoint.
   **→ open.** The other five bank presets are deferred until real exports are available;
   adding one is an `import_sources` row, not a code change.
3. `feature/recurring-detection-engine` — detection + candidates/apply/undo endpoints.
4. `feature/transaction-import-ui` — `TransactionImport.js` upload → map → review → apply flow.

### Backlog (beyond the current feature)

- **Admin page for category management** — add/rename/re-bucket/retire categories + colour
  picker, CRUD over the `categories` table. Scoped after transaction import ships.
- Per-bucket budget targets; bucket views in Cash Flow / Pay Cycle tabs.
- Map Up's category taxonomy to app categories.
- FK `entries.category` → `categories(id)` once the admin page lands.
- Phase 2: transaction ledger view + actual-vs-budget reconciliation via `matched_entry_id`.
- Existing `TODO.md` items from PRs #19/#20 (calendar-accurate summary, `nextDue`
  advancement, `getCurrentCycleWindow` month-end bug, etc.).
