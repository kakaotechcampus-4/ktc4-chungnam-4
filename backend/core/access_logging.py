"""H-4: 초대 링크의 bearer 토큰과 학부모 검색어가 uvicorn 접근 로그에 남지 않게 합니다."""

import logging
import re

_INVITE_PATH = re.compile(r"(/(?:api/v1/parent-invites|invite)/)[^/?\s]+")
# 검색어에는 아이 이름이 들어갑니다. URL 인코딩돼 있어도 풀면 그대로 읽힙니다.
_SEARCH_QUERY = re.compile(r"([?&]q=)[^&\s]*")


def _redact(value: str) -> str:
    return _SEARCH_QUERY.sub(r"\1[redacted]", _INVITE_PATH.sub(r"\1[redacted]", value))


class RedactAccessLog(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                _redact(value) if isinstance(value, str) else value for value in record.args
            )
        record.msg = _redact(str(record.msg))
        return True


def configure_access_logging() -> None:
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, RedactAccessLog) for item in logger.filters):
        logger.addFilter(RedactAccessLog())
