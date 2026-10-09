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

    # 미디어 원본을 두는 S3 버킷 (FR-15). 파일은 브라우저가 presigned URL로 직접 올리고
    # 서버를 지나지 않습니다. 버킷이 없어도 앱은 뜨고 업로드만 실패합니다(face_embedding_key와 같은 방식).
    # 자격증명은 여기 두지 않습니다 — 캠퍼스 AWS는 IAM 액세스 키 발급이 막혀 있어(#29),
    # 서버는 EC2 인스턴스 롤, 로컬은 `aws sso login`으로 받은 기본 자격증명을 boto3가 찾아 씁니다.
    s3_bucket: str | None = None
    s3_region: str = "ap-northeast-2"
    # 업로드 URL 유효기간. 최악 회선(1MB/s)에서 3GB를 올리는 약 51분을 덮습니다
    # (presigned 스파이크 §6, docs/api/media-face.md 임시 결정(김동건)). 자격증명 잔여 수명보다
    # 길게 요청하면 발급은 되지만 그 시점에 조용히 죽으므로 발급할 때 잘라냅니다.
    s3_upload_url_expires_seconds: int = Field(default=3600, gt=0)

    # TODO(태은): AI 기능 배포 전에는 키 누락을 차단하도록 필수값 검증을 추가합니다.
    # Redis·worker 연습은 AI 호출 없이 실행하므로 현재는 빈 값을 허용합니다.
    anthropic_api_key: SecretStr = SecretStr("")
    # 기수·팀별로 게이트웨이 주소가 달라 default를 비워둠 — 반드시 .env에서 설정
    llm_gateway_base_url: str = ""
    # 게이트웨이의 모델 ID 형식(제공자/모델명)을 그대로 사용
    anthropic_model: str = "anthropic/claude-sonnet-5"

    # 로그인 토큰 서명 키. 없으면 앱은 뜨지만 로그인만 실패합니다 — 다른 도메인
    # 개발이 키 때문에 막히지 않게 하기 위함입니다 (face_embedding_key와 같은 방식).
    # 생성: python3 -c "import secrets;print(secrets.token_urlsafe(48))"
    jwt_secret: SecretStr | None = None
    # 사진 100~150장 업로드 도중 끊기지 않도록 넉넉히 둡니다
    # (docs/api/auth.md "세션·토큰 만료 시간" 임시 결정(엄태은) 24시간).
    jwt_expire_hours: int = Field(default=24, gt=0)

    @field_validator("jwt_secret")
    @classmethod
    def require_strong_jwt_secret(cls, value: SecretStr | None) -> SecretStr | None:
        """짧은 키로 HS256을 서명하면 서명을 되맞출 수 있습니다 (RFC 7518 §3.2).

        PyJWT는 경고만 하고 그대로 서명하므로, 약한 키가 조용히 운영에 들어갑니다.
        여기서 막습니다. 키 값 자체는 메시지에 넣지 않습니다 (H-4).
        """
        if value is None:
            return value
        secret = value.get_secret_value()
        if not secret:
            return None
        if len(secret.encode("utf-8")) < 32:
            raise ValueError(
                "JWT_SECRET must be at least 32 bytes. Generate one with: "
                'python3 -c "import secrets;print(secrets.token_urlsafe(48))"'
            )
        return value

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
