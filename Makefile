.PHONY: up down build logs ps shell-api shell-db psql reset-db secret seed \
        backup restore db-version \
        test test-backend test-backend-coverage test-frontend test-frontend-ci \
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
db-version:
	@$(DBEXEC) sh -c 'exec psql -U "$(DBU)" -d "$(DBN)" \
		-c "SELECT version, dirty FROM schema_migrations;"' 2>/dev/null \
		|| echo "No schema_migrations table — the database is empty, or migrations have never run."

## Wipe the database volume and restart fresh
reset-db:
	docker compose down -v
	docker compose up -d --build

## Generate a secure JWT secret
secret:
	openssl rand -hex 32

## Backup the database to backup_YYYYMMDD_HHMMSS.sql in the project root
backup:
	@f=backup_$$(date +%Y%m%d_%H%M%S).sql; \
	$(DBEXEC) sh -c 'exec pg_dump -U "$(DBU)" -d "$(DBN)" \
		--clean --if-exists --no-owner --no-privileges' > $$f \
		&& echo "Wrote $$f" \
		|| { rm -f $$f; echo "Backup FAILED — no file written."; exit 1; }

## Restore a backup: make restore FILE=backup_20260101_120000.sql
##
## Replaces the entire contents of the database. The schema is dropped and the
## dump is loaded in ONE transaction with ON_ERROR_STOP, so a restore either
## fully succeeds or leaves the existing data untouched. Loading a dump into a
## populated database without dropping first is what produced the silent
## half-restore this target used to have.
restore:
	@test -n '$(FILE)' \
		|| { echo "FILE is required, e.g. make restore FILE=backup_20260101_120000.sql"; exit 1; }
	@test -f '$(FILE)' || { echo "No such backup file: $(FILE)"; exit 1; }
	@echo "⚠️  This REPLACES the entire contents of the database with $(FILE)."
	@echo "    Everything currently in it is dropped first. Ctrl-C within 5s to abort."
	@sleep 5
	@docker compose stop api >/dev/null
	@$(DBEXEC) sh -c 'exec psql -U "$(DBU)" -d "$(DBN)" \
		-v ON_ERROR_STOP=1 --single-transaction \
		-c "DROP SCHEMA IF EXISTS public CASCADE" \
		-c "CREATE SCHEMA public" \
		-f -' < '$(FILE)' \
		|| { echo "Restore FAILED — the database was left unchanged."; \
		     docker compose start api >/dev/null; exit 1; }
	@docker compose start api >/dev/null
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
