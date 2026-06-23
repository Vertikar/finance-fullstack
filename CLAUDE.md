# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the app

```bash
make up          # build and start all services (http://localhost:8080)
make down        # stop all services
make logs-api    # tail API logs
make reset-db    # ⚠️ DESTRUCTIVE — wipes postgres volume and restarts
```

### Tests

```bash
# Local (requires Go 1.22+ and Node 20+)
make test                   # both suites in CI mode
make test-backend           # go test ./... -v
make test-backend-coverage  # + HTML report at backend/coverage.html
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

## Architecture

**Stack:** Go 1.22 API → PostgreSQL 16, served behind nginx which proxies `/api/*` to the Go backend and serves the React SPA for everything else. All orchestrated with Docker Compose.

### Backend (`backend/`)

- `main.go` — chi router setup, migration runner, JWT secret validation at startup. Handlers are struct types with a `DB *sql.DB` field; the JWT secret is passed explicitly, no handler reads `os.Getenv` directly.
- `db/db.go` — postgres connection pool with retry loop.
- `handlers/auth.go` — `POST /api/auth/register` and `POST /api/auth/login`, bcrypt passwords, returns JWT.
- `handlers/entries.go` — full CRUD for `Entry` records plus `GET /api/entries/summary` which computes monthly-equivalent totals using `freqMultiplier`. All routes are user-scoped via `mw.GetUserID(r)`.
- `handlers/import_export.go` — `GET /api/entries/export` (CSV download) and `POST /api/entries/import` (multipart CSV upload).
- `handlers/settings.go` — `GET/PUT /api/settings/pay-cycle` for per-user pay cycle preferences.
- `middleware/auth.go` — JWT validation middleware; exposes `GetUserID(r)` to extract the claim.
- `migrations/` — embedded into the binary via `//go:embed`; applied automatically on startup using `golang-migrate`. Files follow `{NNN}_{title}.{up|down}.sql` naming.

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

`Entry` has: `id` (uuid), `name`, `amount`, `type` (`income`|`expense`), `frequency` (one of 6 values), `category`, `nextDue` (date string).

All six frequencies are enforced by a DB constraint and mirrored in `freqMultiplier` (Go) and `FREQ_META` (JS). When adding a new frequency, update both, the DB constraint (new migration), and `utils.js`.

### Testing patterns

Go tests use `go-sqlmock` to mock the database — tests instantiate handler structs directly without starting a server. Frontend tests use `@testing-library/react` with `fetch` mocked via `jest.fn()` in each test file. New features must have accompanying tests (see memory).

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
