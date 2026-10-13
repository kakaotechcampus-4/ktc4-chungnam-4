import os

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

# Test collection must not depend on a developer's .env or running PostgreSQL.
os.environ["POSTGRES_PASSWORD"] = "test-only-password"

from core.config import Settings
from core.database import get_db
from main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_liveness_does_not_require_database(client):
    def unavailable_session():
        raise AssertionError("Liveness must not open a database session")

    app.dependency_overrides[get_db] = unavailable_session
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_database_health_executes_query(client):
    test_engine = create_engine("sqlite://", connect_args={"check_same_thread": False})

    def test_session():
        with Session(test_engine) as session:
            yield session

    app.dependency_overrides[get_db] = test_session
    response = client.get("/health/db")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
    test_engine.dispose()


def test_database_failure_returns_503_without_connection_details(client):
    class FailedSession:
        def execute(self, statement):
            raise OperationalError("SELECT 1", {}, Exception("private-host:secret"))

    app.dependency_overrides[get_db] = lambda: FailedSession()
    response = client.get("/health/db")
    assert response.status_code == 503
    assert response.json() == {"status": "error", "database": "unavailable"}
    assert "secret" not in response.text


def test_database_password_special_characters_are_preserved():
    password = "a@b:/c#d% e"
    settings = Settings(_env_file=None, postgres_password=password)
    assert settings.database_url.password == password
    assert settings.database_url.drivername == "postgresql+psycopg"
    assert password not in repr(settings)


@pytest.mark.parametrize("password", ["", "replace-with-a-generated-password"])
def test_empty_or_example_password_is_rejected(password):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, postgres_password=password)


def test_agents_and_photo_analysis_gateways_are_configured_separately(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_GATEWAY_BASE_URL", "https://agents.example/v1")
    monkeypatch.setenv("ANTHROPIC_MODEL", "anthropic/claude-sonnet-5")
    monkeypatch.setenv("VISION_GATEWAY_BASE_URL", "https://vision.example/v1")
    monkeypatch.setenv("VISION_MODEL", "glm-5.3-flash")

    settings = Settings(_env_file=None, postgres_password="test-only")

    assert settings.llm_gateway_base_url == "https://agents.example/v1"
    assert settings.anthropic_model == "anthropic/claude-sonnet-5"
    assert settings.vision_gateway_base_url == "https://vision.example/v1"
    assert settings.vision_model == "glm-5.3-flash"
