"""공유 가능한 초대 토큰이 접근 로그에 남지 않는지 검사합니다."""

import logging

from core.access_logging import RedactInviteToken


def test_초대_요청_경로는_토큰을_가리고_상태코드는_남긴다():
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        '%s - "%s %s HTTP/%s" %s',
        ("127.0.0.1", "POST", "/api/v1/parent-invites/test-bearer-secret/accept", "1.1", 201),
        None,
    )
    assert RedactInviteToken().filter(record)
    output = record.getMessage()
    assert "test-bearer-secret" not in output
    assert "/parent-invites/[redacted]/accept" in output
    assert "201" in output
