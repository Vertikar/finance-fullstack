[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

# Finance Manager — Full Stack

A personal finance dashboard for tracking recurring income and expenses across all payment
frequencies. Built with a **Go API**, **PostgreSQL** database, and **React** frontend,
orchestrated with Docker Compose and protected by a GitHub Actions CI pipeline.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                               Docker Compose                                     │
│                                                                                  │
│  ┌─────────────────┐   nginx /api/*   ┌──────────────────┐   SQL   ┌──────────┐ │
│  │  React (nginx)  │ ───────────────► │    Go API        │ ──────► │ Postgres │ │
│  │  :8080          │ ◄─────────────── │    :8081         │ ◄────── │  :5432   │ │
│  └─────────────────┘   JSON / JWT     └──────────────────┘         └──────────┘ │
│        builder stage: node:20         golang:1.22 → alpine:3.20   postgres:16   │
└──────────────────────────────────────────────────────────────────────────────────┘

CI (GitHub Actions — runs on every PR and push to main)
  ├── Backend Tests  →  go test -race ./...
  ├── Frontend Tests →  react-scripts test --watchAll=false --coverage
  └── Docker Build   →  docker buildx build (backend + frontend)
```

---

## Features

- **Multi-frequency support** — weekly, fortnightly, monthly, quarterly, biannual, yearly
- **Dashboard** — monthly/annual KPIs, savings-rate indicator, upcoming payments (60-day window)
- **Cash Flow** — day-by-day projection for the next 90 days, grouped by month
- **Payments** — full CRUD for recurring income and expense entries with category tagging
- **Auth** — JWT-based register/login; all entry data is scoped per user
- **Persistent storage** — PostgreSQL with automatic migrations on startup
- **Dockerised tests** — run the full test suite on any host with no local runtime required

---

## Quick Start

```bash
# 1. Copy the example env and fill in secrets
cp .env.example .env

# Generate a strong JWT secret
make secret   # paste the output into .env as JWT_SECRET
# Also set a strong DB_PASSWORD in .env

# 2. Build and start everything
make up

# 3. Open in browser
open http://localhost:8080
```

Migrations run automatically on API startup — no manual schema setup needed.

---

## Project Structure

```
finance-fullstack/
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions CI pipeline
│
├── docker-compose.yml          # production stack (db, api, web)
├── docker-compose.test.yml     # isolated test containers (no runtime needed on host)
├── Makefile                    # all common commands
├── .env                        # secrets & config — never commit this
├── .env.example                # template to copy from
│
├── backend/                    # Go 1.22 REST API
│   ├── main.go                 # server entry point, routing, migration runner
│   ├── go.mod                  # module deps (replace directives for github.com mirrors)
│   ├── go.sum                  # dependency checksums — must be committed
│   ├── Dockerfile              # multi-stage: golang:1.22 builder → alpine:3.20
│   ├── Dockerfile.test         # test runner image (race detector enabled)
│   ├── db/
│   │   └── db.go               # postgres connection pool with retry loop
│   ├── handlers/
│   │   ├── auth.go             # POST /api/auth/register, POST /api/auth/login
│   │   ├── auth_test.go        # unit tests — register, login, error cases
│   │   ├── entries.go          # GET/POST/PUT/DELETE /api/entries + /summary
│   │   └── entries_test.go     # unit tests — CRUD, biannual frequency, summary calc
│   ├── middleware/
│   │   ├── auth.go             # JWT validation middleware
│   │   └── auth_test.go        # unit tests — valid/expired/wrong-secret/malformed tokens
│   └── migrations/
│       ├── 001_initial.up.sql      # users + entries schema, updated_at trigger
│       ├── 001_initial.down.sql    # rollback: drop tables
│       ├── 002_add_biannual_frequency.up.sql   # adds 'biannual' to frequency constraint
│       └── 002_add_biannual_frequency.down.sql # rollback: restores original constraint
│
└── frontend/                   # React 18 SPA
    ├── Dockerfile              # multi-stage: node:20 builder → nginx:1.27
    ├── Dockerfile.test         # test runner image (CI=true)
    ├── nginx/default.conf      # SPA fallback + /api proxy to Go API
    ├── package.json            # deps including @testing-library suite
    ├── package-lock.json       # lockfile — must be committed for npm ci
    └── src/
        ├── index.js            # React root
        ├── api.js              # typed fetch wrapper for all API endpoints
        ├── api.test.js         # unit tests — all API methods, auth headers, error handling
        ├── utils.js            # pure financial functions (toMonthly, addFreq, buildCashFlow…)
        ├── utils.test.js       # unit tests — all frequencies, currency formatting, cash flow
        ├── setupTests.js       # jest-dom setup
        ├── AuthScreen.js       # login / register UI
        └── App.js              # main dashboard (Overview, Payments, Cash Flow tabs)
```

---

## Payment Frequencies

All six frequencies are supported end-to-end — in the UI, the API, the database constraint,
and the monthly-equivalent calculations:

| Frequency   | Periods/year | Monthly multiplier | Example use case            |
|-------------|-------------:|-------------------:|-----------------------------|
| Weekly      |           52 |            52 ÷ 12 | Casual wages                |
| Fortnightly |           26 |            26 ÷ 12 | Most Australian salaries    |
| Monthly     |           12 |                  1 | Rent, subscriptions         |
| Quarterly   |            4 |              1 ÷ 3 | Council rates, electricity  |
| Biannual    |            2 |              1 ÷ 6 | Car registration, insurance |
| Yearly      |            1 |             1 ÷ 12 | Annual memberships          |

---

## API Reference

### Auth (public)

| Method | Path                    | Body                    | Returns          |
|--------|-------------------------|-------------------------|------------------|
| POST   | `/api/auth/register`    | `{email, password}`     | `{token, user}`  |
| POST   | `/api/auth/login`       | `{email, password}`     | `{token, user}`  |

### Entries (JWT required — `Authorization: Bearer <token>`)

| Method | Path                    | Description                              |
|--------|-------------------------|------------------------------------------|
| GET    | `/api/entries`          | List all entries for the current user    |
| POST   | `/api/entries`          | Create a new entry                       |
| PUT    | `/api/entries/:id`      | Update an entry (must be owner)          |
| DELETE | `/api/entries/:id`      | Delete an entry (must be owner)          |
| GET    | `/api/entries/summary`  | Monthly income/expense totals by category|

### Entry schema

```json
{
  "id":        "uuid",
  "name":      "Car Registration",
  "amount":    900.00,
  "type":      "expense",
  "frequency": "biannual",
  "category":  "Transport",
  "nextDue":   "2026-09-01"
}
```

Valid `frequency` values: `weekly` · `fortnightly` · `monthly` · `quarterly` · `biannual` · `yearly`

### Health

| Method | Path      | Returns              |
|--------|-----------|----------------------|
| GET    | `/health` | `{"status": "ok"}`   |

---

## Testing

### Run in Docker (no local runtime needed)

```bash
make test-docker           # backend + frontend
make test-docker-backend   # Go tests only
make test-docker-frontend  # React/Jest tests only
```

### Run locally (requires Go 1.22+ and Node 20+)

```bash
make test                  # both suites, CI mode
make test-backend          # go test ./... -v
make test-backend-coverage # + HTML coverage report → backend/coverage.html
make test-frontend-ci      # react-scripts test --watchAll=false --coverage
make test-frontend         # watch mode (development)
```

### Test coverage

| Area               | File(s)                                   | What is tested                                              |
|--------------------|-------------------------------------------|-------------------------------------------------------------|
| Auth handler       | `backend/handlers/auth_test.go`           | Register/login success, duplicate email, bad password, 401s |
| Entries handler    | `backend/handlers/entries_test.go`        | List, Create (incl. biannual), Delete, Summary calculation  |
| JWT middleware     | `backend/middleware/auth_test.go`         | Valid token, expired, wrong secret, malformed, missing      |
| Financial utils    | `frontend/src/utils.test.js`              | All 6 frequencies, currency formatting, cash flow projection|
| API client         | `frontend/src/api.test.js`                | All endpoints, auth headers, error propagation              |

---

## CI/CD — GitHub Actions

The pipeline at `.github/workflows/ci.yml` runs on every pull request targeting `main`
and on every push to `main`.

```
PR opened / push to main
        │
        ├─► Backend Tests (Go)      go test -race -v ./...
        │       ↓ pass
        ├─► Frontend Tests (React)  npm run test:ci (coverage enforced)
        │       ↓ both pass
        └─► Docker Build Check      buildx build (backend + frontend, no push)
```

**Branch protection** — configure in GitHub → Settings → Branches → Add ruleset for `main`:

- ✅ Require status checks: `Backend Tests (Go)`, `Frontend Tests (React)`, `Docker Build Check`
- ✅ Require branches to be up to date before merging
- ✅ Require a pull request before merging

No PR can merge to `main` until all three checks pass.

---

## Common Commands

```bash
# ── Application ─────────────────────────────────
make up                  # build and start all services
make down                # stop all services
make build               # rebuild images from scratch (no cache)
make logs                # tail all container logs
make logs-api            # tail API logs only
make logs-web            # tail frontend logs only
make logs-db             # tail database logs only
make ps                  # show running containers

# ── Database ─────────────────────────────────────
make psql                # open interactive postgres prompt
make backup              # dump to backup_YYYYMMDD_HHMMSS.sql
make restore FILE=<path> # restore from a SQL dump
make reset-db            # ⚠️  DESTRUCTIVE — permanently deletes ALL data (see below)

> ⚠️  **`make reset-db` is destructive and irreversible.**
> It runs `docker compose down -v`, which permanently deletes the `postgres_data` Docker
> volume and **all financial data stored in it**. It then rebuilds and restarts all
> services from scratch.
>
> Only run this in development when you need a clean slate. Always run `make backup`
> first if you have data you want to keep. Never run it against a production instance.

# ── Secrets ──────────────────────────────────────
make secret              # generate a 32-byte hex JWT secret

# ── Shells ───────────────────────────────────────
make shell-api           # sh into the running API container
make shell-db            # sh into the running DB container
```

---

## Configuration (`.env`)

Copy `.env.example` to `.env` before first run. Never commit `.env`.

| Variable      | Default                           | Description                          |
|---------------|-----------------------------------|--------------------------------------|
| `DB_USER`     | `finance`                         | PostgreSQL username                  |
| `DB_PASSWORD` | `finance`                         | PostgreSQL password — **change this**|
| `DB_NAME`     | `finance`                         | PostgreSQL database name             |
| `JWT_SECRET`  | `change-me-in-production-…`       | JWT signing secret — **change this** |
| `TZ`          | `Australia/Sydney`                | Container timezone                   |

---

## Data Persistence

Financial data is stored in a named Docker volume (`postgres_data`). It survives
`docker compose down` and container restarts. Only `docker compose down -v` removes it.

**Backup:** `make backup` — creates `backup_YYYYMMDD_HHMMSS.sql` in the project root.

**Restore:** `make restore FILE=backup_20260101_120000.sql`

---

## Database Migrations

Migrations are embedded into the API binary at compile time and applied automatically
on startup using `golang-migrate`. Files follow the `{version}_{title}.{up|down}.sql`
naming convention required by the `iofs` source driver.

| File                                         | Description                                  |
|----------------------------------------------|----------------------------------------------|
| `001_initial.up.sql`                         | Create `users`, `entries` tables and trigger |
| `001_initial.down.sql`                       | Drop all tables                              |
| `002_add_biannual_frequency.up.sql`          | Expand `frequency` constraint to add biannual|
| `002_add_biannual_frequency.down.sql`        | Revert to original frequency constraint      |

After pulling changes that include new migrations, run `make reset-db` on a development
instance, or let the API apply them automatically on restart in production.

---

## Production Checklist

- [ ] Set a strong `DB_PASSWORD` in `.env` (`make secret` outputs a good value)
- [ ] Set a strong `JWT_SECRET` in `.env` (`make secret`)
- [ ] Remove the direct `ports` exposure on `db` and `api` in `docker-compose.yml`
- [ ] Place a TLS-terminating reverse proxy in front (Caddy or nginx + Let's Encrypt)
- [ ] Set up scheduled database backups (`make backup` via cron or similar)
- [ ] Switch `restart: unless-stopped` to `restart: always` in `docker-compose.yml`
- [ ] Add the three CI status checks as required in GitHub branch protection for `main`
