"""비밀번호 재설정 메일 발송 인터페이스.

발송 업체(AWS SES 등)가 정해지지 않아 인터페이스와 "보내지 않는" 기본 구현만 둡니다
(docs/open-questions.md §D). 업체가 정해지면 `PasswordResetSender`를 만족하는 구현체를 더하고
`get_password_reset_sender`가 그것을 돌려주게 바꿉니다.

수신 주소와 링크(토큰 포함)는 어디에도 로그로 남기지 않습니다 (H-4).
"""

import logging
from typing import Protocol

logger = logging.getLogger(__name__)


class PasswordResetSender(Protocol):
    """재설정 링크를 사용자에게 전달합니다."""

    def send(self, *, to_email: str, reset_url: str) -> None: ...


class DisabledPasswordResetSender:
    """발송 업체가 정해지기 전 기본값. 아무것도 보내지 않고 사실만 경고로 남깁니다."""

    def send(self, *, to_email: str, reset_url: str) -> None:
        # 이메일·링크는 찍지 않습니다 (H-4).
        logger.warning("Password reset mail was not sent: no mail provider is configured")


def get_password_reset_sender() -> PasswordResetSender:
    """FastAPI 의존성. 테스트는 `app.dependency_overrides`로 바꿉니다."""
    # TODO(정은): 발송 업체가 정해지면 실제 구현체를 돌려줍니다.
    return DisabledPasswordResetSender()
