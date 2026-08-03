# Convenience targets. All Python runs through uv.

.PHONY: db-up db-migrate ingest-status normalize edges metrics api fe test

db-up:
	docker compose up -d
	docker compose ps

db-migrate:
	uv run lda-db migrate

ingest-status:
	uv run lda-ingest status

normalize:
	uv run lda-normalize --all-verified

edges:
	uv run lda-edges --all

metrics:
	uv run lda-metrics --all

api:
	uv run uvicorn lda_api.main:app --reload --port 8000

fe:
	cd frontend && npm run dev

test:
	uv run pytest
