.PHONY: dev build lint test db-migrate-up db-migrate-down check-services

dev-backend:
	cd backend && air

dev-frontend:
	cd frontend && npm run dev

dev:
	docker compose up -d
	@echo "Services started. Run 'make dev-backend' and 'make dev-frontend' in separate terminals."

build:
	cd backend && go build -o bin/server cmd/server/main.go
	cd frontend && npm run build

lint-backend:
	cd backend && golangci-lint run

lint-frontend:
	cd frontend && npm run lint

lint: lint-backend lint-frontend

test-backend:
	cd backend && go test ./...

test-frontend:
	cd frontend && npm run test

test: test-backend test-frontend

db-migrate-up:
	migrate -path backend/migrations -database "postgres://postgres:postgres@localhost:5433/shroom?sslmode=disable" up

db-migrate-down:
	migrate -path backend/migrations -database "postgres://postgres:postgres@localhost:5433/shroom?sslmode=disable" down

check-services:
	docker compose ps
