.PHONY: up down build logs ps shell-api shell-db psql reset-db secret seed \
        backup restore db-version \
        test test-backend test-backend-coverage test-migrations \
        test-frontend test-frontend-ci \
        test-docker test-docker-backend test-docker-frontend

# ── Database connection ──────────────────────────────────────────────────────
# docker-compose passes DB_USER / DB_NAME from .env into the db container as
# POSTGRES_USER / POSTGRES_DB. These targets read those values back out of the
# container rather than re-parsing .env here, so they can never drift from the
# values the database was actually created with.
#
# Override for a single invocation:  make psql DB_USER=other DB_NAME=otherdb
DB_USER ?=
DB_NAME ?=

# Resolved inside the container: explicit override wins, else the container's own value.
DBU = $${DB_USER:-$$POSTGRES_USER}
DBN = $${DB_NAME:-$$POSTGRES_DB}
DBEXEC = docker compose exec -T -e DB_USER='$(DB_USER)' -e DB_NAME='$(DB_NAME)' db

## Start everything (build if needed)
up:
	docker compose up -d --build

## Stop all services
down:
	docker compose down

## Rebuild without cache
build:
	docker compose build --no-cache

## Tail logs for all services
logs:
	docker compose logs -f

## Tail logs for a specific service: make logs-api
logs-api:
	docker compose logs -f api

logs-web:
	docker compose logs -f web

logs-db:
	docker compose logs -f db

## Show running containers
ps:
	docker compose ps

## Shell into the API container
shell-api:
	docker compose exec api sh

## Shell into the DB container
shell-db:
	docker compose exec db sh

## Open a psql prompt
psql:
	docker compose exec -e DB_USER='$(DB_USER)' -e DB_NAME='$(DB_NAME)' db \
		sh -c 'exec psql -U "$(DBU)" -d "$(DBN)"'

## Show the applied migration version and dirty flag
##
## Only "the table isn't there" is reported as an empty database. Any other
## failure (container down, bad credentials) keeps its own error on stderr —
## this is the target you reach for *because* something is wrong, so guessing
## at the cause here is worse than saying nothing.
db-version:
	@$(DBEXEC) sh -c 'set -e; \
		exists=$$(psql -U "$(DBU)" -d "$(DBN)" -qAt \
			-c "SELECT to_regclass('"'"'schema_migrations'"'"') IS NOT NULL"); \
		if [ "$$exists" = t ]; then \
			psql -U "$(DBU)" -d "$(DBN)" -c "SELECT version, dirty FROM schema_migrations;"; \
		else \
			echo "No schema_migrations table — the database is empty, or migrations have never run."; \
		fi'

## Wipe the database volume and restart fresh
reset-db:
	docker compose down -v
	docker compose up -d --build

## Generate a secure JWT secret
secret:
	openssl rand -hex 32

## Backup the database to backup_YYYYMMDD_HHMMSS.dump in the project root
##
## Custom format (-Fc), not plain SQL. A plain .sql dump has no integrity check
## of its own: truncate one and psql will replay it happily to the point it
## stops and report success. A custom archive is self-describing, so a
## truncated or corrupt file is a hard read error — which is what lets
## `restore` refuse it. See the pre-flight check in `restore` below.
backup:
	@f=backup_$$(date +%Y%m%d_%H%M%S).dump; \
	$(DBEXEC) sh -c 'exec pg_dump -U "$(DBU)" -d "$(DBN)" -Fc' > $$f \
		&& echo "Wrote $$f" \
		|| { rm -f $$f; echo "Backup FAILED — no file written."; exit 1; }

## Restore a backup: make restore FILE=backup_20260101_120000.dump
##
## Replaces the entire contents of the database: schema `public` is dropped and
## the backup loaded in its place. Both formats are accepted — the custom
## archives `make backup` writes now, and the plain .sql dumps it used to.
##
## The whole file is READ AND VALIDATED BEFORE ANYTHING IS DROPPED, because
## neither format fails loudly on its own when truncated:
##
##   - custom (-Fc): `pg_restore -f /dev/null` decodes every block without
##     touching the database. `pg_restore -l` is NOT enough — it only reads the
##     table of contents at the head of the file and passes on an archive whose
##     data blocks are missing.
##   - plain .sql: a truncated dump is not a SQL *error*, so ON_ERROR_STOP never
##     fires — psql reaches EOF, exits 0 and COMMITS a half-restored database.
##     Require pg_dump's end-of-dump trailer instead.
##
## The dump's own schema_migrations version is then compared against the
## migrations in backend/migrations/, which is what the API binary embeds. A dump
## from a branch with a NEWER migration would leave the database ahead of the
## binary and crash-loop the API, so it is refused up front rather than diagnosed
## afterwards with `make db-version`. (This re-reads a custom archive a second
## time; only noticeable on very large dumps.)
##
## FORCE=1 skips the confirmation delay and downgrades the version check to a
## warning. It does NOT bypass the truncation check — that one is never right.
restore:
	@test -n '$(FILE)' \
		|| { echo "FILE is required, e.g. make restore FILE=backup_20260101_120000.dump"; exit 1; }
	@test -f '$(FILE)' || { echo "No such backup file: $(FILE)"; exit 1; }
	@if [ "$$(head -c 5 '$(FILE)')" = "PGDMP" ]; then \
		$(DBEXEC) sh -c 'exec pg_restore -f /dev/null' < '$(FILE)' \
			|| { echo "$(FILE) is a truncated or corrupt pg_dump archive. Nothing was changed."; exit 1; }; \
	else \
		grep -q '^-- PostgreSQL database dump complete' '$(FILE)' \
			|| { echo "$(FILE) is not a complete SQL dump — pg_dump's end-of-dump trailer is missing."; \
			     echo "It is truncated. Nothing was changed."; exit 1; }; \
	fi
	@dumpver=; \
	if [ "$$(head -c 5 '$(FILE)')" = "PGDMP" ]; then \
		dumpver=$$($(DBEXEC) sh -c 'exec pg_restore -f -' < '$(FILE)' \
			| awk '/^COPY public\.schema_migrations /{getline; print $$1; exit}'); \
	else \
		dumpver=$$(awk '/^COPY public\.schema_migrations /{getline; print $$1; exit}' '$(FILE)'); \
	fi; \
	maxver=$$(ls backend/migrations/*.up.sql 2>/dev/null \
		| sed 's|.*/||; s|_.*||; s|^0*||' | sort -n | tail -1); \
	case "$$dumpver" in ''|*[!0-9]*) dumpver= ;; esac; \
	case "$$maxver"  in ''|*[!0-9]*) maxver=  ;; esac; \
	if [ -n "$$dumpver" ] && [ -n "$$maxver" ] && [ "$$dumpver" -gt "$$maxver" ]; then \
		echo "⚠️  $(FILE) was taken at migration version $$dumpver, but this build embeds only $$maxver."; \
		echo "    Restoring it leaves the database ahead of the API, which then crash-loops with:"; \
		echo "      Migration failed: no migration found for version $$dumpver: read down ... file does not exist"; \
		echo "    That reads like a missing file; it means the database is ahead of this build."; \
		echo "    Fix: check out the branch carrying migration $$dumpver, or restore an older backup."; \
		if [ -n '$(FORCE)' ]; then \
			echo "    FORCE=1 — restoring anyway."; \
		else \
			echo "    Nothing was changed."; exit 1; \
		fi; \
	fi
	@echo "⚠️  This REPLACES the entire contents of the database with $(FILE)."
	@test -n '$(FORCE)' || { \
		echo "    Everything currently in it is dropped first. Ctrl-C within 5s to abort."; \
		sleep 5; }
	@docker compose stop api >/dev/null; \
	trap 'trap - EXIT INT TERM; docker compose start api >/dev/null' EXIT INT TERM; \
	if [ "$$(head -c 5 '$(FILE)')" = "PGDMP" ]; then \
		$(DBEXEC) sh -c 'exec psql -U "$(DBU)" -d "$(DBN)" -q -v ON_ERROR_STOP=1 \
			-c "DROP SCHEMA IF EXISTS public CASCADE" \
			-c "CREATE SCHEMA public"' \
		&& $(DBEXEC) sh -c 'exec pg_restore -U "$(DBU)" -d "$(DBN)" \
			--single-transaction --no-owner --no-privileges' < '$(FILE)'; \
	else \
		$(DBEXEC) sh -c 'exec psql -U "$(DBU)" -d "$(DBN)" -q \
			-v ON_ERROR_STOP=1 --single-transaction \
			-c "DROP SCHEMA IF EXISTS public CASCADE" \
			-c "CREATE SCHEMA public" \
			-f -' < '$(FILE)'; \
	fi \
		|| { echo "Restore FAILED."; exit 1; }
	@echo "Restored from $(FILE)."
	@echo "The dump also restored schema_migrations — confirm it matches this branch: make db-version"

## Seed the database with test data (test@example.com / testpassword)
seed:
	@$(DBEXEC) sh -c 'exec psql -U "$(DBU)" -d "$(DBN)" -v ON_ERROR_STOP=1' < backend/seed.sql

# ── Tests (local — requires Go and Node installed) ──────────────────────────

## Run backend unit tests locally
test-backend:
	cd backend && go test ./... -v

## Run backend tests with HTML coverage report
test-backend-coverage:
	cd backend && go test ./... -coverprofile=coverage.out && go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report written to backend/coverage.html"

## Run the migration checks, including the up→down→up round trip (needs a Postgres)
test-migrations:
	@test -n '$(MIGRATE_TEST_DATABASE_URL)' || { \
		echo "MIGRATE_TEST_DATABASE_URL is required — a Postgres this test may create and drop databases on."; \
		echo "The database you name is never migrated; the test works in a throwaway it creates itself."; \
		echo; \
		echo "With the local stack running (make up), the db container exposes 5432:"; \
		echo "  make test-migrations MIGRATE_TEST_DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/DBNAME?sslmode=disable'"; \
		exit 1; }
	cd backend && MIGRATE_TEST_DATABASE_URL='$(MIGRATE_TEST_DATABASE_URL)' MIGRATE_TEST_REQUIRE_DB=1 \
		go test . -count=1 -run TestMigration -v

## Run frontend unit tests locally (watch mode)
test-frontend:
	cd frontend && npm test

## Run frontend tests locally in CI mode (no watch, with coverage)
test-frontend-ci:
	cd frontend && npm run test:ci

## Run all tests locally (CI-friendly, no watch)
test:
	cd backend && go test ./... -v
	cd frontend && npm run test:ci

# ── Tests (Docker — works on any host, no local runtime needed) ─────────────

## Run all tests inside Docker containers
test-docker:
	docker compose -f docker-compose.test.yml --profile all build
	docker compose -f docker-compose.test.yml --profile all run --rm test-backend
	docker compose -f docker-compose.test.yml --profile all run --rm test-frontend

## Run only backend tests inside Docker
test-docker-backend:
	docker compose -f docker-compose.test.yml --profile backend build test-backend
	docker compose -f docker-compose.test.yml --profile backend run --rm test-backend

## Run only frontend tests inside Docker
test-docker-frontend:
	docker compose -f docker-compose.test.yml --profile frontend build test-frontend
	docker compose -f docker-compose.test.yml --profile frontend run --rm test-frontend
