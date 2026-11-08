"""공유 가능한 초대 토큰과 학부모 검색어가 접근 로그에 남지 않는지 검사합니다."""

import logging

import pytest

from core.access_logging import RedactAccessLog

ENCODED_NAME = "%EA%B9%80%EC%A7%80%EC%9A%B0"


def _access_log(method: str, path: str, status: int) -> str:
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        '%s - "%s %s HTTP/%s" %s',
        ("127.0.0.1", method, path, "1.1", status),
        None,
    )
    assert RedactAccessLog().filter(record)
    return record.getMessage()


def test_초대_요청_경로는_토큰을_가리고_상태코드는_남긴다():
    output = _access_log("POST", "/api/v1/parent-invites/test-bearer-secret/accept", 201)
    assert "test-bearer-secret" not in output
    assert "/parent-invites/[redacted]/accept" in output
    assert "201" in output


@pytest.mark.parametrize(
    ("path", "kept"),
    [
        (f"/api/v1/children/c1/parent-notes?q={ENCODED_NAME}", "/parent-notes?q=[redacted]"),
        (f"/api/v1/children/c1/parent-media?q={ENCODED_NAME}", "/parent-media?q=[redacted]"),
        (
            f"/api/v1/children/c1/parent-notes?q={ENCODED_NAME}&cursor=2026-10-20",
            "?q=[redacted]&cursor=2026-10-20",
        ),
        (
            f"/api/v1/children/c1/parent-media?cursor=2026-10-20&q={ENCODED_NAME}",
            "?cursor=2026-10-20&q=[redacted]",
        ),
    ],
)
def test_학부모_검색어는_가리고_경로와_상태코드는_남긴다(path: str, kept: str):
    output = _access_log("GET", path, 200)
    assert ENCODED_NAME not in output
    assert kept in output
    assert "200" in output


def test_이름이_q로_끝나는_다른_값은_가리지_않는다():
    output = _access_log("GET", "/api/v1/classes/c1/jobs?seq=3", 200)
    assert "?seq=3" in output
