SHELL := /bin/bash

.PHONY: api worker migrate seed e2e test

api:
	go run ./cmd/api

worker:
	go run ./cmd/worker

migrate:
	go run ./cmd/migrate

seed:
	go run ./cmd/seed

e2e:
	bash scripts/e2e.sh
