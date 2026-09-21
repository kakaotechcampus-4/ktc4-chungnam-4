import os
import shutil
import subprocess
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parents[1]


def test_revision_history_starts_empty() -> None:
    config = Config(str(BACKEND / "alembic.ini"))
    assert ScriptDirectory.from_config(config).get_heads() == []


def test_offline_sql_runs_from_another_directory(tmp_path: Path) -> None:
    env = dict(os.environ, POSTGRES_PASSWORD="test@:/#% password", POSTGRES_HOST="invalid")
    result = subprocess.run(
        [
            sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"),
            "upgrade", "head", "--sql",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "test@:/#% password" not in result.stdout + result.stderr
    assert "CREATE TABLE" not in result.stdout


def test_revision_template_generates_importable_script(tmp_path: Path) -> None:
    script_dir = tmp_path / "alembic"
    shutil.copytree(BACKEND / "alembic", script_dir)
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(script_dir))
    revision = command.revision(config, message="template check")
    assert revision is not None
    assert callable(revision.module.upgrade)
    assert callable(revision.module.downgrade)
    assert revision.down_revision is None
