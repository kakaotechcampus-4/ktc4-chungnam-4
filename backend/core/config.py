from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Aidam API"
    app_env: Literal["local", "test", "production"] = "local"
    postgres_host: str = "localhost"
    postgres_port: int = Field(default=5432, ge=1, le=65535)
    postgres_user: str = "postgres"
    postgres_password: SecretStr
    postgres_db: str = "ktc4"

    celery_broker_url: str = "redis://localhost:6379/0"  # 작업을 보낼 Redis 주소
    celery_result_backend: str = "redis://localhost:6379/1"  # 상태·결과를 저장할 Redis 주소
    celery_result_expires: int = Field(default=86400, gt=0)

    # 얼굴 임베딩 AES 키 (NFR-01). base64로 인코딩한 32바이트.
    # TODO(donggeon): KMS 연동 전까지 쓰는 로컬 키입니다. 키 관리 방식 확정 후 교체.
    face_embedding_key: SecretStr | None = None
    face_embedding_key_ref: str = "local-dev-1"  # FaceEmbedding.key_ref에 저장되는 키 식별자

    # TODO(태은): AI 기능 배포 전에는 키 누락을 차단하도록 필수값 검증을 추가합니다.
    # Redis·worker 연습은 AI 호출 없이 실행하므로 현재는 빈 값을 허용합니다.
    anthropic_api_key: SecretStr = SecretStr("")
    # 기수·팀별로 게이트웨이 주소가 달라 default를 비워둠 — 반드시 .env에서 설정
    llm_gateway_base_url: str = ""
    # 게이트웨이의 모델 ID 형식(제공자/모델명)을 그대로 사용
    anthropic_model: str = "anthropic/claude-sonnet-5"

    @field_validator("postgres_password")
    @classmethod
    def require_configured_password(cls, value: SecretStr) -> SecretStr:
        if (
            not value.get_secret_value()
            or value.get_secret_value() == "replace-with-a-generated-password"
        ):
            raise ValueError("Generate a database password with scripts/init_env.py")
        return value

    @property
    def database_url(self) -> URL:
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password.get_secret_value(),
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
