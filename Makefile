.PHONY: up down build logs ps shell-api shell-db psql reset-db secret seed \
        test test-backend test-backend-coverage test-frontend test-frontend-ci \
        test-docker test-docker-backend test-docker-frontend

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
	docker compose exec db psql -U finance -d finance

## Wipe the database volume and restart fresh
reset-db:
	docker compose down -v
	docker compose up -d --build

## Generate a secure JWT secret
secret:
	openssl rand -hex 32

## Backup the database
backup:
	docker compose exec db pg_dump -U finance finance > backup_$$(date +%Y%m%d_%H%M%S).sql

## Restore a backup: make restore FILE=backup_20260101_120000.sql
restore:
	docker compose exec -T db psql -U finance -d finance < $(FILE)

## Seed the database with test data (test@example.com / testpassword)
seed:
	docker compose exec -T db psql -U finance -d finance < backend/seed.sql

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
