from pathlib import Path
import shutil
import subprocess
import sys

import pytest


PLACEHOLDER = "replace-with-a-generated-password"
PASSWORD_ENTRY = f"POSTGRES_PASSWORD={PLACEHOLDER}\n"


@pytest.fixture
def script(tmp_path: Path) -> Path:
    # 실제 개인 .env를 건드리지 않고 임시 디렉터리에서 스크립트를 실행합니다.
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    source = Path(__file__).resolve().parents[1] / "scripts" / "init_env.py"
    return Path(shutil.copyfile(source, scripts / "init_env.py"))


def run_script(script: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script)],
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_generates_password_only_in_password_entry(script: Path) -> None:
    root = script.parents[1]
    comment = f"# {PASSWORD_ENTRY}"
    template = comment + "POSTGRES_USER=postgres\n" + PASSWORD_ENTRY
    (root / ".env.example").write_text(template)

    result = run_script(script)

    assert result.returncode == 0, result.stderr
    generated = (root / ".env").read_text()
    password = next(
        line.partition("=")[2]
        for line in generated.splitlines()
        if line.startswith("POSTGRES_PASSWORD=")
    )
    assert password and password != PLACEHOLDER
    assert generated == comment + "POSTGRES_USER=postgres\n" + f"POSTGRES_PASSWORD={password}\n"
    assert password not in result.stdout + result.stderr
    assert (root / ".env").stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    "template",
    [
        "POSTGRES_USER=postgres\n",
        "POSTGRES_PASSWORD=changed-placeholder\n",
        "POSTGRES_PASSWORD=\n",
        f"# {PASSWORD_ENTRY}POSTGRES_USER=postgres\n",
        PASSWORD_ENTRY + "POSTGRES_PASSWORD=another-value\n",
    ],
    ids=["missing-key", "changed-placeholder", "empty-value", "comment-only", "duplicate-key"],
)
def test_invalid_template_does_not_create_env(script: Path, template: str) -> None:
    root = script.parents[1]
    (root / ".env.example").write_text(template)

    result = run_script(script)

    assert result.returncode != 0
    assert "Invalid .env.example" in result.stderr
    assert not (root / ".env").exists()


def test_invalid_template_preserves_existing_empty_file(script: Path) -> None:
    root = script.parents[1]
    (root / ".env.example").write_text("POSTGRES_USER=postgres\n")
    destination = root / ".env"
    destination.touch()

    result = run_script(script)

    assert result.returncode != 0
    assert destination.read_bytes() == b""


def test_existing_env_is_preserved_without_reading_template(script: Path) -> None:
    root = script.parents[1]
    destination = root / ".env"
    original = "POSTGRES_PASSWORD=existing-test-password\n"
    destination.write_text(original)

    result = run_script(script)

    assert result.returncode == 0, result.stderr
    assert destination.read_text() == original
    assert "existing-test-password" not in result.stdout + result.stderr
