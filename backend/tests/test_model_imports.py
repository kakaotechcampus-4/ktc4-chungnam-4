import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("module_name", ["core.base", "domains.agents.models"])
def test_model_import_does_not_initialize_database(module_name: str) -> None:
    # 별도 프로세스에서 검사해 다른 테스트의 설정 로딩과 모듈 캐시를 배제합니다.
    environment = os.environ.copy()
    environment["POSTGRES_PASSWORD"] = ""
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    script = """
import importlib
import sys
from unittest.mock import patch

with patch("sqlalchemy.create_engine", side_effect=AssertionError("DB engine initialized")):
    importlib.import_module(sys.argv[1])

assert "core.config" not in sys.modules, "DB settings loaded"
assert "core.database" not in sys.modules, "DB module loaded"
"""
    result = subprocess.run(
        [sys.executable, "-c", script, module_name],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
