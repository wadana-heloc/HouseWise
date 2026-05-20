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


settings = Settings()
