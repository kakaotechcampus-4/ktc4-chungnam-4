import os
import shutil
import subprocess
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from alembic import command

BACKEND = Path(__file__).resolve().parents[1]


def test_리비전_히스토리에_갈래가_없다() -> None:
    """head가 둘 이상이면 두 사람이 같은 리비전에서 각자 마이그레이션을 만든 것이다.

    그 상태로 배포하면 alembic이 어느 쪽을 적용할지 몰라 upgrade가 멈춘다. 첫
    마이그레이션이 생기기 전에는 이 파일이 "히스토리가 비어 있다"를 검사했는데,
    이제는 그 자리에서 갈래를 막는다.
    """
    config = Config(str(BACKEND / "alembic.ini"))
    assert len(ScriptDirectory.from_config(config).get_heads()) == 1


def test_offline_sql_runs_from_another_directory(tmp_path: Path) -> None:
    env = dict(os.environ, POSTGRES_PASSWORD="test@:/#% password", POSTGRES_HOST="invalid")
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(BACKEND / "alembic.ini"),
            "upgrade",
            "head",
            "--sql",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        # 실패도 검사 대상이라 예외 대신 returncode로 확인합니다.
        check=False,
    )
    assert result.returncode == 0, result.stderr
    # 이 테스트의 핵심 — 비밀번호가 SQL·에러 메시지 어디에도 새지 않는다 (H-4).
    assert "test@:/#% password" not in result.stdout + result.stderr
    # DB에 붙지 않고도 실제 DDL이 나온다. 마이그레이션이 생기기 전에는 이 자리에서
    # "CREATE TABLE이 없다"를 검사했지만, 이제는 나오는 것이 정상이다.
    assert "CREATE TABLE draft_documents" in result.stdout


def test_revision_template_generates_importable_script(tmp_path: Path) -> None:
    script_dir = tmp_path / "alembic"
    shutil.copytree(BACKEND / "alembic", script_dir)
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(script_dir))
    revision = command.revision(config, message="template check")
    assert revision is not None
    assert callable(revision.module.upgrade)
    assert callable(revision.module.downgrade)
    # 새 리비전은 현재 head 뒤에 붙는다. 첫 마이그레이션이 없던 때는 None이었다.
    current_head = ScriptDirectory.from_config(config).get_current_head()
    assert revision.down_revision is not None
    assert revision.revision == current_head
