# Finance Manager — Full Stack

A personal finance dashboard with a **Go API**, **PostgreSQL** database, and **React** frontend,
all orchestrated with Docker Compose.

```
┌─────────────────┐   nginx proxy   ┌─────────────────┐     SQL      ┌──────────────┐
│  React (nginx)  │ ──────────────► │   Go API        │ ───────────► │  PostgreSQL  │
│  :8080          │ ◄────────────── │   :8081         │ ◄─────────── │  :5432       │
└─────────────────┘   JSON / JWT    └─────────────────┘              └──────────────┘
```

---

## Quick Start

```bash
# 1. Generate a strong JWT secret and set it in .env
make secret   # copy the output
# Edit .env → JWT_SECRET=<paste here>
# Also set a strong DB_PASSWORD in .env

# 2. Build and start everything
make up

# 3. Open in browser
open http://localhost:8080
```

That's it. Migrations run automatically on API startup.

---

## Project Structure

```
finance-fullstack/
├── docker-compose.yml
├── .env                        # secrets & config (never commit this)
├── Makefile                    # handy shortcuts
│
├── backend/                    # Go API
│   ├── main.go                 # server entry, routing, migrations
│   ├── go.mod
│   ├── Dockerfile
│   ├── db/
│   │   └── db.go               # postgres connection pool
│   ├── handlers/
│   │   ├── auth.go             # register / login
│   │   └── entries.go          # CRUD + summary
│   ├── middleware/
│   │   └── auth.go             # JWT validation
│   └── migrations/
│       └── 001_initial.sql     # schema (auto-applied)
│
└── frontend/                   # React app
    ├── Dockerfile
    ├── nginx/default.conf      # SPA + /api proxy config
    ├── package.json
    └── src/
        ├── index.js
        ├── api.js              # typed API client
        ├── AuthScreen.js       # login / register UI
        └── App.js              # main dashboard
```

---

## API Reference

### Auth (public)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/auth/register` | `{email, password}` | `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` | `{token, user}` |

### Entries (JWT required)

All requests need: `Authorization: Bearer <token>`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/entries` | List all entries for current user |
| POST | `/api/entries` | Create an entry |
| PUT | `/api/entries/:id` | Update an entry (must own it) |
| DELETE | `/api/entries/:id` | Delete an entry (must own it) |
| GET | `/api/entries/summary` | Monthly income/expense totals |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{"status":"ok"}` |

---

## Common Commands

```bash
make up          # start everything
make down        # stop everything
make logs        # tail all logs
make logs-api    # tail API logs only
make psql        # open postgres prompt
make backup      # dump database to SQL file
make reset-db    # DANGER: wipe data and restart fresh
make secret      # generate a new JWT secret
```

---

## Configuration (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_USER` | `finance` | Postgres username |
| `DB_PASSWORD` | `finance` | Postgres password — **change this** |
| `DB_NAME` | `finance` | Postgres database name |
| `JWT_SECRET` | `change-me…` | JWT signing secret — **change this** |
| `TZ` | `Australia/Sydney` | Container timezone |

---

## Data Persistence

Financial data is stored in PostgreSQL in a named Docker volume (`postgres_data`).
It survives `docker compose down` and restarts. Only `docker compose down -v` removes it.

**Backup:** `make backup` → creates `backup_YYYYMMDD_HHMMSS.sql` in the current directory.

**Restore:** `make restore FILE=backup_20260101_120000.sql`

---

## Production Checklist

- [ ] Set a strong `DB_PASSWORD` in `.env`
- [ ] Run `make secret` and set `JWT_SECRET` in `.env`
- [ ] Remove the `ports` exposure on `db` and `api` in `docker-compose.yml` (let nginx proxy handle all traffic)
- [ ] Put nginx or a reverse proxy in front with TLS (Let's Encrypt / Caddy)
- [ ] Set up automated database backups (`make backup` on a cron)
- [ ] Change `restart: unless-stopped` to `restart: always` for full auto-recovery
