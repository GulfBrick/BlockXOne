# OpenAPI Notes

For speed, this MVP does not ship a full OpenAPI file yet.
Endpoints are implemented under `/v1/*` in `cmd/api/routes.go`.

Recommended next step: generate OpenAPI via:
- Swaggo (Go annotations), or
- Manually author `docs/openapi.yaml` and keep it under CI.
