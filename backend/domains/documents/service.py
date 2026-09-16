"""documents 서비스 로직 — 후속 구현.

이번 주는 함수 자리와 의도만 정의한다. 실제 권한 검사·상태 전이·게시/회수 로직은
다음 스프린트에서 채운다 (Notion 백엔드 계획 "이번 주 범위" 참고).

H-1: 학부모 노출은 반드시 get_letter_for_parent()/list_letters_for_parent() 두
게이트 함수를 거친다. 이 함수들 밖에서 학부모에게 초안 본문을 반환하지 않는다.

버전 충돌 검사 공통 주의사항 (update_draft/approve_draft/publish_drafts/
revoke_publication 전부 해당): "조회해서 버전 비교 후 별도로 UPDATE"하는 방식은
그 사이에 다른 요청이 끼어들면 버전 체크가 있어도 동시 수정을 못 막는다
(TOCTOU). 비교와 갱신을 하나의 UPDATE 문으로 묶어서 원자적으로 처리한다:

    result = db.execute(
        update(DraftDocument)
        .where(DraftDocument.id == draft_id, DraftDocument.version == expected_version)
        .values(..., version=DraftDocument.version + 1)
    )
    if result.rowcount == 0:
        raise Conflict()  # 그 사이 다른 요청이 버전을 바꿨다는 뜻

(또는 SQLAlchemy `version_id_col` 매퍼 옵션으로 ORM이 같은 패턴을 대신하게 해도 된다.)

열람·회수 공통 주의사항 (get_letter_for_parent/revoke_publication 해당): 위 버전
패턴을 각 함수 안에서만 적용해도, 두 함수가 서로 다른 시점에 같은
DocumentPublication 행을 각자 원자적으로 갱신하는 것만으로는 둘 사이의 경합을
못 막는다. "열람 가능한지 조회로 판단 → 그 다음에 first_viewed_at 갱신"처럼
판단과 쓰기를 분리하면, 그 사이에 회수가 끼어들어 이미 "보여줘도 된다"고 판단한
요청이 회수 이후에도 본문을 반환해버릴 수 있다.

해결: "판단"과 "쓰기"를 하나의 UPDATE 문으로 합치고, 서로 상대가 쓰는 필드를
WHERE에 넣는다 — rowcount가 곧 판단 결과다.

    # 열람
    result = db.execute(
        update(DocumentPublication)
        .where(DocumentPublication.id == pub_id, DocumentPublication.revoked_at.is_(None))
        .values(first_viewed_at=func.coalesce(DocumentPublication.first_viewed_at, now))
    )
    if result.rowcount == 0:
        raise NotFound()  # 회수됐거나 존재하지 않음 — 본문을 반환하지 않는다

    # 회수
    result = db.execute(
        update(DocumentPublication)
        .where(
            DocumentPublication.id == pub_id,
            DocumentPublication.revoked_at.is_(None),  # 이미 회수된 행을 또 갱신하지 않는다
            DocumentPublication.first_viewed_at.is_(None),
            DocumentPublication.revoke_deadline > now,
        )
        .values(revoked_at=now)
    )
    if result.rowcount == 0:
        raise Conflict()  # 이미 회수됐거나 열람됐거나 기한이 지났다는 뜻

두 UPDATE가 같은 행을 대상으로 하므로, 어느 쪽이 먼저 커밋되든 나중 것의 WHERE는
그 사이 바뀐 값 때문에 자동으로 막힌다 — PostgreSQL READ COMMITTED(기본 격리
수준)에서 UPDATE는 행 락을 잡은 뒤 WHERE를 커밋된 최신값으로 재평가하기 때문이다.
격리 수준을 REPEATABLE READ 이상으로 바꾸면 이 재평가 대신 직렬화 오류가 날 수
있으니, 그 경우엔 별도 재시도 처리가 필요하다. 이 패턴은 설계·주석 수준까지만
검토됐고, 동시성 자체를 실제로 검증한 테스트는 아직 없다 — 구현 시 동시 요청
테스트로 확인한다.

트랜잭션 범위: 위 UPDATE 예시가 성공(rowcount>0)했다고 바로 커밋하지 않는다.
- 회수: DraftDocument.status/version 갱신과 DocumentPublication.revoked_at
  갱신을 같은 트랜잭션에서 함께 처리하고, 둘 중 하나라도 실패(rowcount==0
  포함)하면 전체 롤백한다 — 상태만 REVOKED로 바뀌고 게시 회차는 안 바뀌는
  반쪽 상태를 남기지 않는다.
- 열람: first_viewed_at 갱신과 audit.record_access() 호출을 같은 트랜잭션에서
  커밋한 뒤에 본문을 응답한다. audit 기록이 실패하면 응답도 실패해야 한다
  (audit/CLAUDE.md — "기록 실패가 본 작업을 조용히 통과시키면 안 된다").

권한 검사는 이 UPDATE들과 별개다: 위 rowcount 조건은 "게시 상태가 유효한가"만
확인하고, "이 교사가 이 초안의 검수 권한이 있는가"·"이 학부모가 이 원아에 대한
접근 권한이 있는가"는 확인하지 않는다. UPDATE 성공을 권한 통과로 착각하지
않는다 — organization 조회(B와 협의)로 권한을 별도로 확인한 뒤에만 이 UPDATE를
실행한다.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from domains.documents.schemas import (
    ApproveResponse,
    DraftDetailResponse,
    ParentLetterDetailResponse,
    ParentLetterListResponse,
    PublishItem,
    PublishResponse,
    RevokeResponse,
)


def get_draft_for_teacher(db: Session, *, draft_id: UUID, teacher_id: UUID) -> DraftDetailResponse:
    # TODO(한상균): 검수 권한 교사인지 확인 — organization의 반 배정 조회 필요 (B와 협의).
    raise NotImplementedError


def update_draft(
    db: Session, *, draft_id: UUID, teacher_id: UUID, content: str, expected_version: int
) -> DraftDetailResponse:
    # TODO(한상균): 버전 비교+갱신은 모듈 docstring의 원자적 UPDATE 패턴으로 (조회 후
    #   별도 비교 금지). rowcount==0이면 충돌(409). 통과 시 RevisionLog에
    #   action=edit, edit_method=manual, before_content(수정 전)·after_content(수정 후)
    #   를 함께 남긴다(테크스펙 RevisionLog ERD).
    raise NotImplementedError


def approve_draft(
    db: Session, *, draft_id: UUID, teacher_id: UUID, expected_version: int, review_confirmed: bool
) -> ApproveResponse:
    # TODO(한상균): 버전 비교+갱신(status=APPROVED, approved_at=now)은 모듈 docstring의
    #   원자적 UPDATE 패턴으로. 승인 차단 조건 확정 필요 — D(정은) 담당
    #   VerificationResult가 passed가 아니면 승인 거부할지, UnclassifiedItem
    #   (ref_type="draft_document")으로 갈지 협의 후 구현. 통과 시 RevisionLog에
    #   action=approve를 남긴다(before/after_content는 비워도 된다).
    raise NotImplementedError


def publish_drafts(
    db: Session, *, items: list[PublishItem], request_id: str, teacher_id: UUID
) -> PublishResponse:
    # TODO(한상균): draft별로 독립 처리 — 하나 실패해도 나머지는 진행하고 결과에
    #   status="failed"+error_code로 표시한다. (request_id, draft_id) 조합이 이미
    #   있으면 기존 회차를 그대로 반환(멱등). 각 draft마다 버전 비교+갱신은 모듈
    #   docstring의 원자적 UPDATE 패턴으로(WHERE status==APPROVED AND
    #   version==expected_version) — rowcount==0이면 상태 불일치인지 버전 충돌인지
    #   구분해 error_code에 담는다. 통과 시 DocumentPublication 새 회차
    #   (round_number += 1, published_version=갱신된 version) 생성,
    #   revoke_deadline = published_at + timedelta(hours=24) 계산. status는
    #   APPROVED로 유지한다 — 바꾸지 않는다 (게이트는 status==APPROVED + 활성
    #   게시 회차 존재로 판단). round_number>=2(재게시)면 RevisionLog에
    #   action=resend를 남긴다 — 테크스펙 action enum에 최초 게시에 대응하는 값이
    #   없어(edit/approve/revoke/resend뿐), 최초 게시(round_number==1)는 로그하지
    #   않는다(approved_at으로 갈음).
    raise NotImplementedError


def revoke_publication(
    db: Session, *, draft_id: UUID, teacher_id: UUID, expected_version: int
) -> RevokeResponse:
    # TODO(한상균): 검수 권한 교사인지부터 확인(B와 협의, UPDATE 성공을 권한 통과로
    #   착각하지 않는다). DraftDocument.version/status 갱신은 모듈 docstring의 버전
    #   UPDATE 패턴으로. 회수 자격(revoke_deadline 이내 + 미열람 + 미회수) 판단은
    #   DocumentPublication 갱신 하나로 — "열람·회수 공통 주의사항" 패턴 그대로 쓴다
    #   (조회로 먼저 판단하지 않는다). rowcount==0이면 이미 회수됐거나 열람됐거나
    #   기한 초과. 두 UPDATE(DraftDocument, DocumentPublication)는 같은 트랜잭션에서
    #   함께 커밋하고, 하나라도 실패하면 전체 롤백한다(모듈 docstring "트랜잭션 범위").
    #   통과 시 RevisionLog에 action=revoke를 남긴다(테크스펙 RevisionLog.action).
    raise NotImplementedError


def list_letters_for_parent(db: Session, *, parent_id: UUID) -> ParentLetterListResponse:
    # TODO(한상균): 단일 게이트 — 활성 게시 회차(revoked_at is null) + 대상 원아 접근권한
    #   (B와 협의: parent_id ↔ child_id 관계 조회) 검사. 목록 조회는 first_viewed_at을
    #   건드리지 않는다 ("목록 조회는 상세 열람으로 취급하지 않는다").
    raise NotImplementedError


def get_letter_for_parent(
    db: Session, *, letter_id: UUID, parent_id: UUID
) -> ParentLetterDetailResponse:
    # TODO(한상균): 대상 원아에 대한 학부모 접근 권한부터 확인(B와 협의, UPDATE 성공을
    #   권한 통과로 착각하지 않는다). "이 편지를 보여줘도 되는가" 판단과
    #   first_viewed_at 기록을 분리하지 않는다 — 모듈 docstring의 "열람·회수 공통
    #   주의사항" 패턴대로 하나의 UPDATE로 합쳐서, 그 rowcount로 보여줄지 말지
    #   정한다(조회로 먼저 판단 후 별도로 쓰기 금지 — 그 사이 회수가 끼어들면 이미
    #   회수된 내용을 반환하게 된다). rowcount==0이면 404(회수됐거나 대상 아님).
    #   통과 시 audit.record_access(actor_type="parent",
    #   target_type="document_publication", action="view_detail")를 같은
    #   트랜잭션에서 커밋한 뒤에만 본문을 응답한다 — 무조건 매번 호출한다
    #   ("학부모 열람은 매번 AccessLog를 남긴다", NFR-05, audit/CLAUDE.md).
    #   first_viewed_at이 이미 있었든 방금 채워졌든 관계없이 호출한다.
    raise NotImplementedError
