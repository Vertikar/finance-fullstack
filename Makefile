.PHONY: up down build logs ps shell-api shell-db psql reset-db secret

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

## Run backend unit tests
test-backend:
	cd backend && go test ./... -v

## Run backend tests with coverage report
test-backend-coverage:
	cd backend && go test ./... -coverprofile=coverage.out && go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: backend/coverage.html"

## Run frontend unit tests (watch mode)
test-frontend:
	cd frontend && npm test

## Run frontend tests in CI mode (no watch, with coverage)
test-frontend-ci:
	cd frontend && npm run test:ci

## Run all tests (CI-friendly, no watch)
test:
	cd backend && go test ./... -v
	cd frontend && npm run test:ci
