from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://lda:lda@localhost:5433/lda"

    # Server-side caps for ego/aggregate views (spec: never ship the full graph).
    node_cap: int = 3000
    neighbor_cap: int = 500

    disclaimer: str = (
        "Data retrieved from the Lobbying Disclosure Act database at lda.gov. "
        "The Secretary of the Senate's Office of Public Records cannot vouch for the "
        "data or analyses derived from it after the data has been retrieved."
    )
