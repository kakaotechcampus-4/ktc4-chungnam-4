import pytest
from pydantic import ValidationError

from core.config import Settings

_AI_SETTINGS = {
    "anthropic_api_key": "test-only-key",
    "llm_gateway_base_url": "https://agents.example/v1",
    "vision_gateway_base_url": "https://vision.example/v1",
}


def test_production_starts_when_ai_settings_are_filled():
    settings = Settings(
        _env_file=None, postgres_password="test-only", app_env="production", **_AI_SETTINGS
    )

    assert settings.app_env == "production"


@pytest.mark.parametrize(
    "field, env_name, value",
    [
        ("anthropic_api_key", "ANTHROPIC_API_KEY", ""),
        ("anthropic_api_key", "ANTHROPIC_API_KEY", "replace-with-your-anthropic-api-key"),
        ("llm_gateway_base_url", "LLM_GATEWAY_BASE_URL", "  "),
        ("llm_gateway_base_url", "LLM_GATEWAY_BASE_URL", "https://<gateway-address>/v1"),
        ("vision_gateway_base_url", "VISION_GATEWAY_BASE_URL", ""),
    ],
)
def test_production_rejects_missing_or_example_ai_settings(field, env_name, value):
    with pytest.raises(ValidationError) as error:
        Settings(
            _env_file=None,
            postgres_password="test-only",
            app_env="production",
            **{**_AI_SETTINGS, field: value},
        )

    assert env_name in str(error.value)
    # 키 값은 메시지에 남기지 않습니다 (H-4)
    assert "test-only-key" not in str(error.value)


@pytest.mark.parametrize("app_env", ["local", "test"])
def test_local_and_test_allow_empty_ai_settings(app_env, monkeypatch: pytest.MonkeyPatch):
    # 다른 테스트가 프로세스 환경변수에 키를 채워 두므로 비웁니다
    for env_name in ("ANTHROPIC_API_KEY", "LLM_GATEWAY_BASE_URL", "VISION_GATEWAY_BASE_URL"):
        monkeypatch.delenv(env_name, raising=False)

    settings = Settings(_env_file=None, postgres_password="test-only", app_env=app_env)

    assert settings.anthropic_api_key.get_secret_value() == ""
