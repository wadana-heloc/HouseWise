from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_ANON_KEY: str
    SUPABASE_JWKS_URL: str
    SUPABASE_JWT_ISSUER: str
    SUPABASE_JWT_AUDIENCE: str = "authenticated"

    APP_DEEP_LINK: str = Field(default="myapp://auth/callback")

    ANTHROPIC_API_KEY: str

    # POST /prices/search — when true, the endpoint uses the dummy Haiku-backed
    # mock (no web search, fake prices, near-zero cost). The router reads this
    # via os.getenv at request time to match the integration guide; this field
    # exists for documentation, type-safety, and .env loading.
    PRICE_AGENT_DUMMY: bool = False


settings = Settings()
