"""H-4: 초대 링크의 bearer 토큰이 uvicorn 접근 로그에 남지 않게 합니다."""

import logging
import re

_INVITE_PATH = re.compile(r"(/(?:api/v1/parent-invites|invite)/)[^/?\s]+")


class RedactInviteToken(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                _INVITE_PATH.sub(r"\1[redacted]", value) if isinstance(value, str) else value
                for value in record.args
            )
        record.msg = _INVITE_PATH.sub(r"\1[redacted]", str(record.msg))
        return True


def configure_access_logging() -> None:
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, RedactInviteToken) for item in logger.filters):
        logger.addFilter(RedactInviteToken())
