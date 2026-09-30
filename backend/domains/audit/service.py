"""audit 공통 기록 함수.

다른 도메인은 이 두 함수만 호출하고 AccessLog/DeletionLog에 직접 INSERT하지
않는다 — audit은 유일하게 역방향 호출이 허용되는 도메인이다 (audit/CLAUDE.md).

여기서 커밋하지 않는다 — 호출한 쪽의 트랜잭션 일부로 남도록 flush만 한다
(backend/CLAUDE.md: 커밋·롤백은 서비스가 결정). 기록 실패를 여기서 삼키지
않는다 — 예외를 그대로 올려서 호출자가 실패를 드러내게 한다.
"""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from sqlalchemy.orm import Session

from domains.audit.models import AccessLog, DeletionLog, DeletionReason, DeletionTargetType


def record_access(
    db: Session,
    *,
    actor_type: str,
    actor_id: UUID,
    target_type: str,
    target_id: UUID,
    action: str,
) -> AccessLog:
    """열람 한 건을 기록한다. actor_id/target_id는 서버 내부 ID만 받는다 (H-4)."""
    log = AccessLog(
        actor_type=actor_type,
        actor_id=actor_id,
        target_type=target_type,
        target_id=target_id,
        action=action,
    )
    db.add(log)
    db.flush()
    return log


def record_deletion(
    db: Session,
    *,
    target_type: DeletionTargetType | str,
    target_id: UUID,
    reason: DeletionReason | str,
) -> DeletionLog:
    """파기 한 건을 기록한다. 행위자는 남기지 않는다 (docs/테크스펙.md DeletionLog
    ERD — 파기는 보관기한 배치처럼 시스템 트리거가 많아 행위자가 항상 있지 않다).

    target_type·reason은 정해진 코드만 받는다 (#74). 허용되지 않은 값·빈 문자열·None이면
    세션에 추가하기 전에 ValueError를 올린다 — 사유 없는 파기 로그를 남기지 않는다."""
    log = DeletionLog(
        target_type=_deletion_code(DeletionTargetType, target_type, "target_type"),
        target_id=target_id,
        reason=_deletion_code(DeletionReason, reason, "reason"),
    )
    db.add(log)
    db.flush()
    return log


def _deletion_code(codes: type[StrEnum], value: object, field: str) -> str:
    try:
        return codes(value).value
    except (ValueError, TypeError):
        allowed = ", ".join(code.value for code in codes)
        # 받은 값은 메시지에 넣지 않는다 — 잘못 넘어온 값이 개인정보일 수 있다 (H-4)
        raise ValueError(f"허용되지 않은 {field}입니다. 허용값: {allowed}") from None
