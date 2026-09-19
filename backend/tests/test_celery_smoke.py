import pytest

from scripts.celery_smoke import practice


def test_practice_returns_completion() -> None:
    assert practice.run({"message": "test"}) == {"message": "작업 완료"}


def test_practice_intentional_failure() -> None:
    with pytest.raises(ValueError, match="Intentional practice failure"):
        practice.run({"message": "test"}, fail=True)


@pytest.mark.parametrize("payload", [{}, {"message": "unexpected"}])
def test_practice_rejects_unexpected_input(payload: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="Practice input"):
        practice.run(payload)


@pytest.mark.parametrize("delay", [-1, 11, 0.5, True])
def test_practice_bounds_delay(delay: float) -> None:
    with pytest.raises(ValueError, match="delay_seconds"):
        practice.run({"message": "test"}, delay_seconds=delay)


def test_common_settings_allow_worker_without_ai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.config import Settings

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    settings = Settings(_env_file=None, postgres_password="test-only")
    assert settings.anthropic_api_key.get_secret_value() == ""
