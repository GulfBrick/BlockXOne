SHELL := /bin/bash

.PHONY: help build test lint docker-build docker-up docker-down migrate seed rollback clean fmt vet security-scan validate-production api worker e2e

# Colors for output
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[0;33m
NC := \033[0m # No Color

## help: Display this help message
help:
	@grep -E '^## ' Makefile | sed 's/## //' | column -t -s ':'

## build: Build all binaries
build:
	@echo "$(CYAN)Building binaries...$(NC)"
	CGO_ENABLED=0 go build -ldflags="-w -s" -o bin/api ./cmd/api
	CGO_ENABLED=0 go build -ldflags="-w -s" -o bin/worker ./cmd/worker
	CGO_ENABLED=0 go build -ldflags="-w -s" -o bin/migrate ./cmd/migrate
	CGO_ENABLED=0 go build -ldflags="-w -s" -o bin/seed ./cmd/seed
	@echo "$(GREEN)Build complete!$(NC)"

## test: Run all tests
test: test-go test-frontend test-contracts

## test-go: Run Go tests with coverage
test-go:
	@echo "$(CYAN)Running Go tests...$(NC)"
	go test -v -race -coverprofile=coverage.out -covermode=atomic ./cmd/... ./internal/... ./scripts/...
	@echo "$(GREEN)Go tests complete!$(NC)"

## test-frontend: Run frontend tests
test-frontend:
	@echo "$(CYAN)Running frontend tests...$(NC)"
	npm test --prefix apps/web -- --run
	@echo "$(GREEN)Frontend tests complete!$(NC)"

## test-contracts: Run smart contract tests
test-contracts:
	@echo "$(CYAN)Running contract tests...$(NC)"
	npm test --prefix contracts
	@echo "$(GREEN)Contract tests complete!$(NC)"

## lint: Run all linters
lint: lint-go lint-frontend

## lint-go: Lint Go code
lint-go:
	@echo "$(CYAN)Linting Go code...$(NC)"
	golangci-lint run -v ./cmd/... ./internal/... ./scripts/...
	@echo "$(GREEN)Go linting complete!$(NC)"

## lint-frontend: Lint frontend code
lint-frontend:
	@echo "$(CYAN)Linting frontend code...$(NC)"
	npm run lint --prefix apps/web
	@echo "$(GREEN)Frontend linting complete!$(NC)"

## fmt: Format all code
fmt:
	@echo "$(CYAN)Formatting code...$(NC)"
	go fmt ./...
	@echo "$(GREEN)Formatting complete!$(NC)"

## vet: Run Go vet
vet:
	@echo "$(CYAN)Running go vet...$(NC)"
	go vet ./cmd/... ./internal/... ./scripts/...
	@echo "$(GREEN)Go vet complete!$(NC)"

## security-scan: Run security scans
security-scan:
	@echo "$(CYAN)Running security scans...$(NC)"
	gosec -tests -severity medium -confidence medium ./cmd/... ./internal/...
	npm audit --prefix apps/web --audit-level=moderate
	npm audit --prefix contracts --audit-level=moderate
	@echo "$(GREEN)Security scan complete!$(NC)"

## validate-production: Validate fail-closed production configuration contract
validate-production:
	pwsh -File .planning/scripts/validate-planning.ps1
	pwsh -File .planning/scripts/validate-production-compose.ps1
	pwsh -File .planning/scripts/validate-ci-policy.ps1

## docker-build: Build all Docker images
docker-build:
	@echo "$(CYAN)Building Docker images...$(NC)"
	docker build -f Dockerfile.api -t blockxone-api:latest .
	docker build -f Dockerfile.worker -t blockxone-worker:latest .
	docker build -f Dockerfile.web -t blockxone-web:latest .
	@echo "$(GREEN)Docker images built!$(NC)"

## docker-up: Refuse production startup until deployment gates are implemented
docker-up: validate-production
	@echo "Production startup remains approval-gated; the validation fixture is not deployable configuration."
	@exit 1

## docker-down: Stop all services
docker-down:
	@echo "$(CYAN)Stopping containers...$(NC)"
	docker compose --env-file config/production.env.example -f docker-compose.prod.yml down
	@echo "$(GREEN)Containers stopped!$(NC)"

## docker-logs: View container logs
docker-logs:
	docker compose --env-file config/production.env.example -f docker-compose.prod.yml logs -f

## docker-clean: Clean up Docker resources
docker-clean:
	@echo "$(CYAN)Cleaning Docker resources...$(NC)"
	docker compose --env-file config/production.env.example -f docker-compose.prod.yml down -v
	@echo "$(GREEN)Docker cleanup complete!$(NC)"

## migrate: Run database migrations
migrate:
	@echo "$(CYAN)Running migrations...$(NC)"
	go run ./cmd/migrate
	@echo "$(GREEN)Migrations complete!$(NC)"

## seed: Seed database with sample data
seed:
	@echo "$(CYAN)Seeding database...$(NC)"
	go run ./cmd/seed
	@echo "$(GREEN)Database seeded!$(NC)"

## rollback: Refuse rollback until a verified forward-recovery/rollback procedure exists
rollback:
	@echo "Rollback is intentionally blocked until schema, application, contract and financial-state recovery are implemented and tested."
	@exit 1

## api: Run API server (development)
api:
	@echo "$(CYAN)Starting API server...$(NC)"
	go run ./cmd/api

## worker: Run worker (development)
worker:
	@echo "$(CYAN)Starting worker...$(NC)"
	go run ./cmd/worker

## e2e: Run end-to-end tests
e2e:
	@echo "$(CYAN)Running E2E tests...$(NC)"
	bash scripts/e2e.sh
	@echo "$(GREEN)E2E tests complete!$(NC)"

## clean: Clean build artifacts
clean:
	@echo "$(CYAN)Cleaning build artifacts...$(NC)"
	rm -rf bin/
	rm -f coverage.out
	go clean -testcache
	@echo "$(GREEN)Cleanup complete!$(NC)"

## ci: Run CI checks (lint, test, build)
ci: validate-production lint test build security-scan
	@echo "$(GREEN)CI checks passed!$(NC)"

## install-tools: Install required development tools
install-tools:
	@echo "$(CYAN)Installing development tools...$(NC)"
	go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2
	go install github.com/securego/gosec/v2/cmd/gosec@v2.25.0
	npm install --prefix apps/web
	npm install --prefix contracts
	@echo "$(GREEN)Tools installed!$(NC)"
