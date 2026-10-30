"""documents 서비스 로직.

save_draft()(agents 생성 결과 저장)만 구현돼 있다. 권한 검사·상태 전이·게시/회수
로직은 함수 자리와 의도만 정의돼 있고 후속 작업에서 채운다.

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
- 교사 쓰기(직접 작성·수정·승인·되돌리기): 응답을 다 만든 뒤에 커밋하고, 응답 준비가
  실패하면 쓰기도 롤백한다(_commit_with_detail).

권한 검사는 이 UPDATE들과 별개다: 위 rowcount 조건은 "게시 상태가 유효한가"만
확인하고, "이 교사가 이 초안의 검수 권한이 있는가"·"이 학부모가 이 원아에 대한
접근 권한이 있는가"는 확인하지 않는다. UPDATE 성공을 권한 통과로 착각하지
않는다 — organization 조회(B와 협의)로 권한을 별도로 확인한 뒤에만 이 UPDATE를
실행한다.
"""

from __future__ import annotations

import base64
import re
import uuid
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Exists, Subquery, delete, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from core.exceptions import (
    AccessLogFailed,
    AidamError,
    ChildAccessDenied,
    ChildNotFound,
    DraftAlreadyApproved,
    DraftAlreadyExists,
    DraftAlreadyPublished,
    DraftNotApprovable,
    DraftNotApproved,
    DraftNotFound,
    DraftNotReady,
    DraftVersionConflict,
    InvalidCursor,
    InvalidSentenceId,
    MediaNotLinkedToChild,
    NoLinkedParent,
    NotParentNote,
    ParentNoteNotFound,
    RequestValidationFailed,
)

# agents도 documents를 import한다(save_draft). 순환이라 이름이 아니라 모듈째 import한다 — 이름을 직접
# import하면 import 순서에 따라 깨진다. import-linter를 도입하면 이 순환을 예외로 적는다.
from domains.agents import service as agents_service
from domains.audit import service as audit_service
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
    EditMethod,
    RevisionAction,
    RevisionLog,
)
from domains.documents.schemas import (
    ChildDraftItem,
    ChildDraftListResponse,
    ClassDraftItem,
    ClassDraftListResponse,
    DraftCreateRequest,
    DraftDetailResponse,
    DraftSaveInput,
    DraftSentenceView,
    DraftSummary,
    DraftUpdateRequest,
    DraftVersionInfo,
    EvidenceView,
    MediaUrl,
    ParentNoteDetailResponse,
    ParentNoteLink,
    ParentNoteListResponse,
    ParentNoteSummary,
    PublicationResult,
    PublishItem,
    PublishRequest,
    PublishResponse,
    RevokeResponse,
)
from domains.media import service as media_service
from domains.organization import service as organization_service

# 자동 생성 결과로 덮어쓰지 않는 상태. 승인·회수된 문서는 교사가 확정한 내용이다.
_AI_LOCKED_STATUSES = (DraftStatus.APPROVED.value, DraftStatus.REVOKED.value)

# 교사가 쓴 문장의 서버 발급 ID (t1, t2…, 임시 결정(정은), #75).
_TEACHER_SENTENCE_ID = re.compile(r"t(\d+)")

# 게시 뒤 회수할 수 있는 기간 (테크스펙 파이프라인 9단계 "24시간 이내 회수").
_REVOKE_WINDOW = timedelta(hours=24)

# 학부모 목록에 싣는 알림장당 사진 수 (docs/api/documents.md "앞 3장").
_LIST_PHOTOS_PER_NOTE = 3
_KST = ZoneInfo("Asia/Seoul")

# 반·날짜 목록의 미리보기 길이 (docs/api/documents.md §GET /classes/{class_id}/drafts, 제안).
_PREVIEW_MAX_CHARS = 100


def get_draft_version(
    db: Session, *, child_id: UUID, doc_type: DocType | str, record_date: date
) -> DraftVersionInfo | None:
    """agents가 재생성으로 저장하기 전에 기존 초안의 버전을 읽는다 (#75 5번).

    같은 원아·문서 종류·날짜의 초안이 없으면 None이다 — 최초 저장으로 보내면 된다.
    agents는 status가 approved·revoked이거나 has_teacher_edits면 재생성을 건너뛰고, 그 밖에는
    돌려받은 draft_id·version으로 save_draft(expected_version=version)를 부른다 (#75 5번 표).
    has_teacher_edits의 기준은 재생성 거부와 같은 _has_teacher_edits()다.

    doc_type은 agents가 가진 tools/contracts.py의 DocType을 그대로 넘겨도 된다 — 값이 같아
    이 도메인의 DocType으로 바꿔 쓴다(계층 규칙상 따로 정의돼 있음, #140 리뷰).

    읽은 값은 판단용이다. 읽은 뒤 교사가 수정하면 save_draft의 버전 검사가 저장을 막는다.
    """
    doc_type = DocType(doc_type)
    row = db.execute(
        select(
            DraftDocument.id,
            DraftDocument.version,
            DraftDocument.status,
            _has_teacher_edits().label("has_teacher_edits"),
        ).where(
            DraftDocument.child_id == child_id,
            DraftDocument.doc_type == doc_type.value,
            DraftDocument.record_date == record_date,
        )
    ).one_or_none()
    if row is None:
        return None
    return DraftVersionInfo(
        draft_id=row.id,
        version=row.version,
        status=DraftStatus(row.status),
        has_teacher_edits=row.has_teacher_edits,
    )


def save_draft(db: Session, data: DraftSaveInput, *, expected_version: int | None) -> DraftDocument:
    """AI가 최종 통과(PASS)한 초안을 저장한다 (FR-05, FR-06, #35, #75).

    - 검증을 통과한 초안만 여기로 오므로 VERIFIED(교사 검토 대기)로 저장한다 (#75·#106).
    - 본문은 data.sentences 순서대로 DraftSentence에 넣는다. position은 0부터다.
    - expected_version이 None이면 최초 생성이다. (child_id, doc_type, record_date)
      문서가 이미 있으면 덮어쓰지 않고 충돌로 거부한다.
    - 값이 있으면 재생성이다. 같은 문서 ID를 유지한 채, 버전이 그대로이고 승인·회수
      전이고 원아·문서 종류·날짜가 기존 문서와 같고 교사가 한 번도 손대지 않았을 때만
      문장을 바꿔 넣는다. 비교와 갱신은 UPDATE 한 문장으로 묶는다(모듈 docstring).
      그 사이 교사 수정·승인이 있었으면 교사 문서를 그대로 두고 충돌로 거부한다 —
      반영하지 못한 AI 결과를 따로 보관하지 않는다.

    커밋하지 않고 flush만 한다. 근거(SentenceEvidence) 저장과 최종 커밋은 호출한 쪽
    트랜잭션에서 처리한다 — 담당 분담은 정은님 확인 전이다 (#35).
    """
    if expected_version is None:
        return _insert_draft(db, data)
    return _update_generated_draft(db, data, expected_version=expected_version)


def _insert_draft(db: Session, data: DraftSaveInput) -> DraftDocument:
    draft = DraftDocument(
        id=data.draft_id or uuid.uuid4(),
        child_id=data.child_id,
        author_teacher_id=data.author_teacher_id,
        doc_type=data.doc_type.value,
        record_date=data.record_date,
        status=DraftStatus.VERIFIED.value,
        ai_version=data.ai_version,
        evidence_bundle_id=data.evidence_bundle_id,
    )
    # begin_nested()는 savepoint를 만들기 전에 대기 중인 변경을 먼저 flush한다. 그
    # 오류를 문서 중복으로 오인하지 않도록 호출자의 변경은 여기서 따로 flush한다 —
    # 실패하면 원래 예외를 그대로 올린다.
    db.flush()
    # 중복 INSERT가 호출자 트랜잭션 전체를 깨지 않도록 savepoint 안에서 넣는다.
    try:
        with db.begin_nested():
            db.add(draft)
            # 문서 행이 들어간 뒤에 문장을 넣는다. 중복 문서면 이 flush에서 멈춰 문장도
            # 같은 savepoint와 함께 되돌아간다.
            db.flush()
            db.add_all(_sentence_rows(draft.id, data))
    except IntegrityError:
        # 예상한 중복(같은 원아·종류·날짜)만 충돌로 바꾼다. 제약 이름은 DB 드라이버마다
        # 꺼내는 방법이 달라서, savepoint를 되돌린 뒤 실제로 그 문서가 있는지 확인한다.
        if _find_draft_id(db, data) is None:
            raise
        raise DraftVersionConflict("같은 원아·문서 종류·날짜의 초안이 이미 있습니다.") from None
    return draft


def _find_draft_id(db: Session, data: DraftSaveInput) -> UUID | None:
    return db.scalar(
        select(DraftDocument.id).where(
            DraftDocument.child_id == data.child_id,
            DraftDocument.doc_type == data.doc_type.value,
            DraftDocument.record_date == data.record_date,
        )
    )


def _update_generated_draft(
    db: Session, data: DraftSaveInput, *, expected_version: int
) -> DraftDocument:
    if data.draft_id is None:
        raise ValueError("재생성 저장에는 draft_id가 필요합니다.")

    result = db.execute(
        update(DraftDocument)
        .where(
            DraftDocument.id == data.draft_id,
            # 다른 원아·종류·날짜의 내용이 잘못된 ID로 들어오는 것을 막는다
            DraftDocument.child_id == data.child_id,
            DraftDocument.doc_type == data.doc_type.value,
            DraftDocument.record_date == data.record_date,
            DraftDocument.version == expected_version,
            DraftDocument.status.notin_(_AI_LOCKED_STATUSES),
            # 교사가 한 번이라도 손댄 문서는 AI 결과로 덮어쓰지 않는다 (#75 6-1). 동시 요청은
            # 이 서브쿼리가 아니라 위 version 비교가 막는다 — READ COMMITTED에서 행 락을
            # 기다린 뒤 WHERE를 다시 볼 때 다른 테이블(RevisionLog·DraftSentence)은 처음
            # 스냅샷으로 평가되지만, 교사 수정·승인은 RevisionLog 기록과 version 증가를 한
            # 트랜잭션에서 하므로 version이 달라져 있다.
            ~_has_teacher_edits(),
        )
        .values(
            status=DraftStatus.VERIFIED.value,
            ai_version=data.ai_version,
            evidence_bundle_id=data.evidence_bundle_id,
            version=DraftDocument.version + 1,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        raise DraftVersionConflict(
            "초안이 없거나, 대상이 다르거나, 그 사이 수정·승인됐습니다. 기존 문서를 유지합니다."
        )
    # 문장은 모두 바꿔 넣는다. 새 초안이 같은 sentence_id를 다른 문장에 쓸 수 있어서
    # 문장별로 맞춰 갱신하지 않는다 (#75).
    db.execute(delete(DraftSentence).where(DraftSentence.draft_id == data.draft_id))
    db.add_all(_sentence_rows(data.draft_id, data))
    db.flush()
    return db.get(DraftDocument, data.draft_id, populate_existing=True)


def _has_teacher_edits() -> ColumnElement[bool]:
    """교사가 이 초안에 한 번이라도 손댔는가 (#75 6-1, 임시 결정(정은)).

    교사의 수정·승인·회수는 모두 RevisionLog에 남는다(documents/CLAUDE.md). 교사가 직접 쓴
    초안은 생성이라 RevisionLog가 없어서, 교사가 쓴 문장(서버가 붙인 `t…`)이 있는지도 본다
    (#139 리뷰). AI 문장 ID는 tools/generation/draft.py가 `s…`로 붙인다. DraftDocument를
    조회·갱신하는 문장 안에서 상관 서브쿼리로 쓴다.
    """
    return or_(
        exists().where(RevisionLog.draft_id == DraftDocument.id),
        exists().where(
            DraftSentence.draft_id == DraftDocument.id,
            DraftSentence.sentence_id.startswith("t"),
        ),
    )


def _sentence_rows(draft_id: UUID, data: DraftSaveInput) -> list[DraftSentence]:
    return [
        DraftSentence(
            draft_id=draft_id,
            sentence_id=sentence.sentence_id,
            position=position,
            text=sentence.text,
        )
        for position, sentence in enumerate(data.sentences)
    ]


def list_class_drafts(
    db: Session,
    *,
    class_id: UUID,
    center_id: UUID | None,
    record_date: date | None,
    doc_type: DocType | None,
    published: bool,
) -> ClassDraftListResponse:
    """반·날짜별 원아 초안 상태 목록 (FR-06, FR-16, docs/api/documents.md).

    - 접근 검사와 재원 원아 명단은 organization이 맡는다. 같은 어린이집 교사면 모든 반을
      본다 (FR-25). 검수 권한이 있는 교사라 승인 전 초안의 미리보기도 싣는다 (H-1).
    - 그날 초안이 있는 원아만 명단 순서대로 담는다. "자료 없음" 행은 FE가 명단과 비교해 만든다.
    - published=True면 활성 게시 회차가 있는 문서만 담는다. 이때 record_date가 없으면
      원아·문서 종류마다 가장 최근 게시본 1건만 담는다 (임시 결정(김진하)).
    """
    if record_date is None and not published:
        raise RequestValidationFailed("record_date는 published=true일 때만 생략할 수 있습니다.")
    roster = organization_service.list_class_children(db, class_id, center_id)
    child_ids = [child.child_id for child in roster.items]
    if not child_ids:
        return ClassDraftListResponse(items=[])

    active = _active_publications()
    stmt = (
        select(DraftDocument, active.c.published_at)
        .outerjoin(active, active.c.draft_id == DraftDocument.id)
        .where(DraftDocument.child_id.in_(child_ids))
        .order_by(DraftDocument.record_date.desc())
    )
    if record_date is not None:
        stmt = stmt.where(DraftDocument.record_date == record_date)
    if doc_type is not None:
        stmt = stmt.where(DraftDocument.doc_type == doc_type.value)
    if published:
        stmt = stmt.where(active.c.published_at.is_not(None))

    # 날짜 최신순이라 원아·문서 종류마다 처음 나온 행이 가장 최근 문서다. 날짜를 정하면
    # (child_id, doc_type, record_date)가 UNIQUE라 원래 한 건씩이다.
    latest: dict[tuple[UUID, str], tuple[DraftDocument, datetime | None]] = {}
    for draft, published_at in db.execute(stmt).tuples():
        latest.setdefault((draft.child_id, draft.doc_type), (draft, published_at))
    previews = _previews(db, [draft.id for draft, _ in latest.values()])

    documents_by_child: dict[UUID, dict[str, DraftSummary]] = {}
    for (child_id, draft_doc_type), (draft, published_at) in latest.items():
        documents_by_child.setdefault(child_id, {})[draft_doc_type] = DraftSummary(
            draft_id=draft.id,
            status=DraftStatus(draft.status),
            version=draft.version,
            published_at=published_at,
            preview=previews.get(draft.id, ""),
        )
    return ClassDraftListResponse(
        items=[
            ClassDraftItem(child_id=child_id, **documents_by_child[child_id])
            for child_id in child_ids
            if child_id in documents_by_child
        ]
    )


def list_child_drafts(
    db: Session, *, child_id: UUID, center_id: UUID | None, doc_type: DocType, published: bool
) -> ChildDraftListResponse:
    """한 원아의 문서 목록 — 알림장 목록과 상세의 날짜 이동 (docs/api/documents.md).

    - 같은 어린이집 원아만 본다. 원아 기준으로 검사한다 — 임시 결정(한상균), #156.
    - 기록 날짜 최신순으로 전부 담는다(페이지 없음). 본문·사진·근거는 상세에서 따로 받는다.
    - published=True면 활성 게시 회차가 있는 문서만 담는다. 회수된 문서는 빠진다.
    - 반·날짜 목록처럼 미리보기만 싣고 열람 기록은 남기지 않는다. 본문과 근거 원문은 상세
      (get_draft_for_teacher)에서만 보고, 그쪽이 AccessLog를 남긴다.
    """
    organization_service.ensure_child_access(db, child_id, center_id)
    active = _active_publications()
    stmt = (
        select(DraftDocument, active.c.published_at)
        .outerjoin(active, active.c.draft_id == DraftDocument.id)
        .where(DraftDocument.child_id == child_id, DraftDocument.doc_type == doc_type.value)
        .order_by(DraftDocument.record_date.desc())
    )
    if published:
        stmt = stmt.where(active.c.published_at.is_not(None))
    rows = db.execute(stmt).tuples().all()
    previews = _previews(db, [draft.id for draft, _ in rows])
    return ChildDraftListResponse(
        items=[
            ChildDraftItem(
                draft_id=draft.id,
                record_date=draft.record_date,
                status=DraftStatus(draft.status),
                version=draft.version,
                published_at=published_at,
                preview=previews.get(draft.id, ""),
            )
            for draft, published_at in rows
        ]
    )


def _is_active_publication() -> ColumnElement[bool]:
    """활성 게시 회차 = 회수되지 않은 회차. 학부모에게 지금 보이는 회차이고, "활성"의 정의는 여기 하나다."""
    return DocumentPublication.revoked_at.is_(None)


def _active_publications() -> Subquery:
    """초안별 활성 게시 회차의 게시 시각.

    활성 회차가 여럿 남아 있어도 가장 최근 것만 본다 — 재게시는 새 회차만 활성으로
    취급한다 (DocumentPublication).
    """
    return (
        select(
            DocumentPublication.draft_id,
            func.max(DocumentPublication.published_at).label("published_at"),
        )
        .where(_is_active_publication())
        .group_by(DocumentPublication.draft_id)
        .subquery()
    )


def _previews(db: Session, draft_ids: Sequence[UUID]) -> dict[UUID, str]:
    if not draft_ids:
        return {}
    rows = db.execute(
        select(DraftSentence.draft_id, DraftSentence.text)
        .where(DraftSentence.draft_id.in_(draft_ids))
        .order_by(DraftSentence.draft_id, DraftSentence.position)
    )
    sentences_by_draft: dict[UUID, list[str]] = {}
    for draft_id, text in rows.tuples():
        sentences_by_draft.setdefault(draft_id, []).append(text)
    return {draft_id: _preview(texts) for draft_id, texts in sentences_by_draft.items()}


def _preview(sentences: Sequence[str]) -> str:
    """앞 문장부터 이어 붙여 100자를 넘기기 직전까지 쓴다. 문장 중간에서 자르지 않는다.

    첫 문장부터 100자를 넘으면 그 문장만 100자에서 자른다 — 빈 미리보기를 내지 않으려는
    것이다 (임시 결정(한상균), docs/api/documents.md의 preview는 제안 상태).
    """
    preview = ""
    for sentence in sentences:
        candidate = f"{preview} {sentence}" if preview else sentence
        if len(candidate) > _PREVIEW_MAX_CHARS:
            break
        preview = candidate
    if preview or not sentences:
        return preview
    return sentences[0][:_PREVIEW_MAX_CHARS]


def get_draft_for_teacher(
    db: Session, *, draft_id: UUID, teacher_id: UUID, center_id: UUID | None
) -> DraftDetailResponse:
    """교사가 초안 상세(문장·문장별 근거·사진)를 본다 (FR-06·FR-07·FR-16·FR-26).

    같은 어린이집 원아의 초안이면 승인 전이어도 본다(H-1 검수 권한). 근거 원문에 실명이
    있어 교사에게만 싣는다. 열람마다 AccessLog(teacher, draft_document, view_detail)를 남기고
    커밋한 뒤 돌려준다 — NFR-05 "모든 열람에 접근 기록", 임시 결정(한상균). 기록에 실패하면
    본문 없이 500이다.
    """
    _draft_for_teacher(db, draft_id, center_id)
    detail = _teacher_detail(db, draft_id)
    try:
        audit_service.record_access(
            db,
            actor_type="teacher",
            actor_id=teacher_id,
            target_type="draft_document",
            target_id=draft_id,
            action="view_detail",
        )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise AccessLogFailed("열람 기록을 남기지 못해 초안을 보여 드릴 수 없습니다.") from None
    return detail


def create_draft(
    db: Session,
    *,
    child_id: UUID,
    teacher_id: UUID,
    center_id: UUID | None,
    request: DraftCreateRequest,
) -> DraftDetailResponse:
    """교사가 자료 없는 원아의 초안을 직접 쓴다 (docs/api/documents.md §POST /children/{child_id}/drafts).

    - 같은 어린이집 원아만 쓴다. 원아 기준으로 검사한다 — 임시 결정(한상균), #156.
    - verified·version 1로 만들어 바로 승인할 수 있다. 근거와 사진은 없다.
    - 문장은 보낸 순서대로 t1, t2…를 붙인다. 수정이 아니라 생성이라 RevisionLog를 남기지 않고,
      t 문장이 있어 AI 재생성이 이 문서를 덮어쓰지 않는다 (_has_teacher_edits, 임시 결정(정은), #139).
    - 같은 원아·문서 종류·날짜의 초안이 이미 있으면 DRAFT_ALREADY_EXISTS다. 동시에 두 번 와도
      유일 제약(uq_draft_child_type_date)이 하나만 남긴다.

    TODO(한상균): "만들면 그 원아·날짜의 미분류 항목을 해소한다"(API 문서)는 UnclassifiedItem에
      원아·날짜가 생긴 뒤에 붙인다 (#196).
    """
    organization_service.ensure_child_access(db, child_id, center_id)
    draft = DraftDocument(
        child_id=child_id,
        author_teacher_id=teacher_id,
        doc_type=request.doc_type.value,
        record_date=request.record_date,
        status=DraftStatus.VERIFIED.value,
    )
    db.add(draft)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(DraftDocument.id).where(
                DraftDocument.child_id == child_id,
                DraftDocument.doc_type == request.doc_type.value,
                DraftDocument.record_date == request.record_date,
            )
        )
        if existing is None:
            raise
        raise DraftAlreadyExists("이 날짜의 초안이 이미 있습니다.") from None
    db.add_all(
        DraftSentence(
            draft_id=draft.id,
            sentence_id=f"t{position + 1}",
            position=position,
            text=sentence.text,
            is_edited_by_teacher=False,
        )
        for position, sentence in enumerate(request.sentences)
    )
    return _commit_with_detail(db, draft.id)


def update_draft(
    db: Session,
    *,
    draft_id: UUID,
    teacher_id: UUID,
    center_id: UUID | None,
    request: DraftUpdateRequest,
) -> DraftDetailResponse:
    """교사가 초안 문장을 직접 고치거나 새 문장을 덧붙인다 (FR-17).

    - 검토 대기(verified)인 초안만 고친다. 승인 뒤에 고치려면 reopen을 먼저 한다.
    - 고친 문장은 is_edited_by_teacher=True가 된다. 교사가 쓴 t… 문장도 고치면 True다
      (임시 결정(한상균), #139). 근거 행은 DB에 남기고 교사 응답에서만 비운다 (#75).
      글자가 그대로인 문장은 고친 것으로 보지 않는다.
    - 새 문장은 맨 뒤에 붙이고 서버가 t1, t2…를 붙인다 — 그 문서 t 번호 최댓값 + 1
      (임시 결정(정은), #75). 새 문장은 is_edited_by_teacher=False다.
    - 고친 문장·새 문장마다 RevisionLog(edit, manual)를 남긴다. 버전 증가와 한 트랜잭션이라
      재생성 거부가 이 문서를 교사가 손댄 문서로 알아본다 (_has_teacher_edits).
    - selected_media_ids를 보내면 알림장 사진을 그 순서로 바꾼다. 고를 수 있는 사진만 받는다
      (_ensure_selectable_photos). TODO(한상균): 사진 선택 변경을 RevisionLog에 남길지는
      docs/api/documents.md의 [확인 필요]로 남아 있다.
    """
    draft = _draft_for_teacher(db, draft_id, center_id)
    values: dict[str, object] = {}
    if request.selected_media_ids is not None:
        _ensure_selectable_photos(db, draft, request.selected_media_ids)
        values["selected_media_ids"] = [str(media_id) for media_id in request.selected_media_ids]
    _claim_version(
        db,
        draft_id,
        expected_version=request.expected_version,
        from_status=DraftStatus.VERIFIED,
        wrong_status=_not_editable,
        values=values,
    )
    # 버전 UPDATE가 이 초안 행을 잡고 있어, 아래에서 읽고 쓰는 동안 다른 수정이 끼지 않는다.
    sentences = {
        sentence.sentence_id: sentence
        for sentence in db.scalars(select(DraftSentence).where(DraftSentence.draft_id == draft_id))
    }
    if any(edit.sentence_id not in sentences for edit in request.sentences):
        db.rollback()
        raise InvalidSentenceId("이 초안에 없는 문장입니다.")

    logs = []
    for edit in request.sentences:
        sentence = sentences[edit.sentence_id]
        if sentence.text == edit.text:
            continue
        logs.append(_edit_log(draft_id, teacher_id, sentence.sentence_id, sentence.text, edit.text))
        sentence.text = edit.text
        sentence.is_edited_by_teacher = True
    next_number = _next_teacher_sentence_number(sentences)
    next_position = max((sentence.position for sentence in sentences.values()), default=-1) + 1
    for offset, added in enumerate(request.added_sentences):
        sentence_id = f"t{next_number + offset}"
        db.add(
            DraftSentence(
                draft_id=draft_id,
                sentence_id=sentence_id,
                position=next_position + offset,
                text=added.text,
                is_edited_by_teacher=False,
            )
        )
        logs.append(_edit_log(draft_id, teacher_id, sentence_id, None, added.text))
    db.add_all(logs)
    return _commit_with_detail(db, draft_id)


def _ensure_selectable_photos(db: Session, draft: DraftDocument, media_ids: Sequence[UUID]) -> None:
    """알림장 사진은 그 원아·그 날짜에 학부모에게 보여도 되는 사진 중에서만 고른다."""
    if not set(media_ids) <= _shareable_photo_ids(db, draft.child_id, draft.record_date):
        raise MediaNotLinkedToChild("이 원아의 그날 사진만 고를 수 있습니다.")


def _shareable_photo_ids(db: Session, child_id: UUID, record_date: date) -> set[UUID]:
    """그 원아·그 날짜에 학부모에게 보여도 되는 사진. 고를 때와 보여 줄 때 같은 범위를 쓴다.

    media의 collect_media_for_llm 범위(llm_allowed, 귀속 원아 전원 ③ 동의)를 그대로 쓴다 —
    다른 아이가 함께 찍힌 사진이 학부모에게 나가는 것을 줄이는 보수적인 범위다(임시 결정
    (한상균), docs/api/documents.md "llm_allowed인 사진만 학부모에게" 제안). 그 함수는
    영상·음성메모도 돌려주므로 사진만 남긴다.
    """
    return {
        media.media_id
        for media in media_service.collect_media_for_llm(db, child_id, record_date)
        if media.type == "photo"
    }


def _not_editable(status: str) -> AidamError:
    if status == DraftStatus.DRAFT.value:
        return DraftNotReady("초안을 만드는 중입니다. 다 만들어진 뒤에 고칠 수 있습니다.")
    return DraftAlreadyApproved("승인된 초안입니다. 승인을 되돌린 뒤에 고칠 수 있습니다.")


def _next_teacher_sentence_number(sentences: dict[str, DraftSentence]) -> int:
    numbers = [
        int(match.group(1))
        for sentence_id in sentences
        if (match := _TEACHER_SENTENCE_ID.fullmatch(sentence_id))
    ]
    return max(numbers, default=0) + 1


def _edit_log(
    draft_id: UUID, teacher_id: UUID, sentence_id: str, before: str | None, after: str
) -> RevisionLog:
    return RevisionLog(
        draft_id=draft_id,
        editor_id=teacher_id,
        action=RevisionAction.EDIT.value,
        edit_method=EditMethod.MANUAL.value,
        target_sentence_id=sentence_id,
        before_content=before,
        after_content=after,
    )


def approve_draft(
    db: Session,
    *,
    draft_id: UUID,
    teacher_id: UUID,
    center_id: UUID | None,
    expected_version: int,
) -> DraftDetailResponse:
    """교사가 검토를 마친 초안을 승인한다 (FR-08, H-1 승인 게이트).

    검토 대기(verified)인 초안만 승인한다. 생성 중(draft)·이미 승인된 초안은 409다.
    승인만으로는 학부모에게 보이지 않는다 — 게시는 따로 한다(승인·게시 분리).

    TODO(한상균): 승인 차단 조건(DraftDecisionLog 등)은 정은과 협의 전이다. 지금은 agents가
      검증을 통과한 초안만 verified로 저장하므로 status 검사로 대신한다.
    """
    _draft_for_teacher(db, draft_id, center_id)
    _change_status(
        db,
        draft_id,
        teacher_id=teacher_id,
        expected_version=expected_version,
        from_status=DraftStatus.VERIFIED,
        to_status=DraftStatus.APPROVED,
        action=RevisionAction.APPROVE,
        wrong_status=lambda _: DraftNotApprovable("검토 대기 중인 초안만 승인할 수 있습니다."),
    )
    return _commit_with_detail(db, draft_id)


def reopen_draft(
    db: Session,
    *,
    draft_id: UUID,
    teacher_id: UUID,
    center_id: UUID | None,
    expected_version: int,
) -> DraftDetailResponse:
    """게시 전 승인을 되돌려 다시 검토하게 한다 (임시 결정(김진하), docs/api/documents.md).

    학부모에게 게시된 초안은 되돌리지 않는다 — 이미 나갔으므로 회수가 따로 필요하다 (H-1).
    """
    _draft_for_teacher(db, draft_id, center_id)
    _change_status(
        db,
        draft_id,
        teacher_id=teacher_id,
        expected_version=expected_version,
        from_status=DraftStatus.APPROVED,
        to_status=DraftStatus.VERIFIED,
        action=RevisionAction.REOPEN,
        wrong_status=lambda _: DraftNotApproved("승인된 초안만 되돌릴 수 있습니다."),
        unless_exists=(
            _active_publication_exists(),
            DraftAlreadyPublished("게시한 알림장은 회수한 뒤에 고칠 수 있습니다."),
        ),
    )
    return _commit_with_detail(db, draft_id)


def _draft_for_teacher(db: Session, draft_id: UUID, center_id: UUID | None) -> DraftDocument:
    """교사가 이 초안을 검수해도 되는지 확인한다 — 같은 어린이집 원아의 초안이어야 한다 (FR-25).

    TODO(한상균): 검사 위치는 #156(권한 검사 위치) 결정에 맞춘다.
    """
    draft = db.get(DraftDocument, draft_id)
    if draft is None:
        raise DraftNotFound("초안을 찾을 수 없습니다.")
    organization_service.ensure_child_access(db, draft.child_id, center_id)
    return draft


def _change_status(
    db: Session,
    draft_id: UUID,
    *,
    teacher_id: UUID,
    expected_version: int,
    from_status: DraftStatus,
    to_status: DraftStatus,
    action: RevisionAction,
    wrong_status: Callable[[str], AidamError],
    unless_exists: tuple[Exists, AidamError] | None = None,
) -> None:
    """초안 상태를 바꾸는 유일한 곳 (documents/CLAUDE.md "상태 전이는 한 함수에서만").

    버전 검사와 상태 갱신을 _claim_version의 UPDATE 한 문장으로 하고, 같은 트랜잭션에서
    RevisionLog를 남긴다. 둘이 함께여야 재생성 거부·get_draft_version이 교사가 손댄 문서를
    알아본다(_has_teacher_edits). 커밋하지 않는다 — 부르는 쪽이 _commit_with_detail로
    응답까지 만든 뒤에 커밋한다.
    """
    approved_at = datetime.now(UTC) if to_status == DraftStatus.APPROVED else None
    _claim_version(
        db,
        draft_id,
        expected_version=expected_version,
        from_status=from_status,
        wrong_status=wrong_status,
        values={"status": to_status.value, "approved_at": approved_at},
        unless_exists=unless_exists,
    )
    db.add(RevisionLog(draft_id=draft_id, editor_id=teacher_id, action=action.value))


def _claim_version(
    db: Session,
    draft_id: UUID,
    *,
    expected_version: int,
    from_status: DraftStatus,
    wrong_status: Callable[[str], AidamError],
    values: dict[str, object],
    unless_exists: tuple[Exists, AidamError] | None = None,
) -> None:
    """버전·상태가 그대로일 때만 version을 1 올리고 values를 쓴다. 커밋하지 않는다.

    비교와 갱신을 UPDATE 한 문장으로 묶는다(모듈 docstring). 실패하면 이유를 다시 읽어 알맞은
    예외로 바꾼다 — 읽기만 하므로 판단과 쓰기가 갈라지지 않는다. 성공하면 이 행을 커밋까지
    잡고 있어, 호출한 쪽의 나머지 쓰기와 다른 수정이 섞이지 않는다.
    """
    conditions = [
        DraftDocument.id == draft_id,
        DraftDocument.version == expected_version,
        DraftDocument.status == from_status.value,
    ]
    if unless_exists is not None:
        conditions.append(~unless_exists[0])
    result = db.execute(
        update(DraftDocument)
        .where(*conditions)
        .values(**values, version=DraftDocument.version + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount:
        return
    db.rollback()
    current = db.get(DraftDocument, draft_id, populate_existing=True)
    if current.version != expected_version:
        raise DraftVersionConflict("그 사이 초안이 바뀌었습니다. 새로 불러온 뒤 다시 해 주세요.")
    if current.status != from_status.value or unless_exists is None:
        raise wrong_status(current.status)
    raise unless_exists[1]


def _signed_media(db: Session, media_ids: Sequence[UUID]) -> list[MediaUrl]:
    """선택 사진·근거 미디어의 서명 URL. 요청 순서대로이고, 없으면 S3를 부르지 않는다."""
    if not media_ids:
        return []
    return [
        MediaUrl(
            media_id=signed.media_id,
            type=signed.type,
            url=signed.url,
            url_expires_at=signed.url_expires_at,
        )
        for signed in media_service.get_signed_urls(db, media_ids)
    ]


def _commit_with_detail(db: Session, draft_id: UUID) -> DraftDetailResponse:
    """교사용 상세 응답을 다 만든 뒤에 커밋한다 — 직접 작성·수정·승인·되돌리기가 함께 쓴다.

    응답을 만들다(서명 URL 등) 실패하면 롤백해 상태·버전·이력도 그대로 둔다. 먼저 커밋하면
    반영은 됐는데 화면에는 실패로 보이고, 다시 누르면 버전이 이미 올라 있어 409가 난다
    (#206 멘토 리뷰). 커밋 전이라도 같은 트랜잭션이라 방금 쓴 값을 읽는다.
    """
    try:
        detail = _teacher_detail(db, draft_id)
    except Exception:
        db.rollback()
        raise
    db.commit()
    return detail


def _teacher_detail(db: Session, draft_id: UUID) -> DraftDetailResponse:
    """교사용 상세 응답 (docs/api/documents.md §GET /drafts/{draft_id}).

    - 문장별 근거는 agents의 list_sentence_evidences로 받는다. 교사가 고친 문장은 원문이 그
      문장을 뒷받침한다고 볼 수 없어 빈 배열로 돌려준다(근거 행은 DB에 남음, #75).
    - media에는 선택 사진, 그다음 보여 주는 근거의 미디어 서명 URL을 겹치지 않게 싣는다.
    - include_photos는 게시할 때 정해져 게시 전에는 null이다.

    TODO(한상균): 작성 교사 이름은 auth 조회 함수(get_teacher_names)가 생기면 채운다. 그전까지
      빈 문자열이다 — FE 타입이 문자열이라 null을 보내지 않는다.
    """
    draft = db.get(DraftDocument, draft_id, populate_existing=True)
    sentences = db.scalars(
        select(DraftSentence)
        .where(DraftSentence.draft_id == draft_id)
        .order_by(DraftSentence.position)
    )
    # include_photos도 필요해 회차 행을 읽는다. 여럿이면 _active_publications()처럼 가장 최근 것
    publication = db.scalar(
        select(DocumentPublication)
        .where(DocumentPublication.draft_id == draft_id, _is_active_publication())
        .order_by(DocumentPublication.published_at.desc())
        .limit(1)
    )
    selected_media_ids = [UUID(media_id) for media_id in draft.selected_media_ids]
    evidences_by_sentence = agents_service.list_sentence_evidences(db, draft_id)
    views = [
        DraftSentenceView(
            sentence_id=sentence.sentence_id,
            text=sentence.text,
            is_edited_by_teacher=sentence.is_edited_by_teacher,
            evidences=[]
            if sentence.is_edited_by_teacher
            else [
                EvidenceView.model_validate(evidence, from_attributes=True)
                for evidence in evidences_by_sentence.get(sentence.sentence_id, [])
            ],
        )
        for sentence in sentences
    ]
    evidence_media_ids = [
        evidence.media_id
        for view in views
        for evidence in view.evidences
        if evidence.media_id is not None
    ]
    return DraftDetailResponse(
        draft_id=draft.id,
        child_id=draft.child_id,
        doc_type=DocType(draft.doc_type),
        record_date=draft.record_date,
        status=DraftStatus(draft.status),
        version=draft.version,
        title=None,
        sentences=views,
        selected_media_ids=selected_media_ids,
        media=_signed_media(db, list(dict.fromkeys(selected_media_ids + evidence_media_ids))),
        author_teacher_id=draft.author_teacher_id,
        author_name="",
        approved_at=draft.approved_at,
        published_at=publication.published_at if publication else None,
        include_photos=publication.include_photos if publication else None,
        updated_at=draft.updated_at,
    )


def publish_drafts(
    db: Session, *, request: PublishRequest, teacher_id: UUID, center_id: UUID | None
) -> PublishResponse:
    """승인된 알림장을 학부모에게 게시한다 (FR-08·FR-09, 승인·게시 분리).

    초안마다 따로 처리하고 따로 커밋한다 — 하나가 실패해도 나머지는 게시되고, 실패한 건은
    error_code로 알린다(docs/api/documents.md). 같은 날 두 번째 게시를 서버가 막지는 않는다:
    건별 실패를 다시 올릴 수 있어야 해서 "반 전체·하루 한 번"은 FE 화면 규칙으로 둔다.

    보호자가 연결되지 않은 원아는 NO_LINKED_PARENT로 거른다 — 게시해도 볼 사람이 없다.
    """
    results = []
    for item in request.items:
        try:
            results.append(_publish_one(db, item, request, teacher_id, center_id))
        except AidamError as error:
            db.rollback()
            draft = db.get(DraftDocument, item.draft_id)
            # 접근이 거부된 건에는 그 원아 ID·버전을 싣지 않는다 — 다른 어린이집 정보가 샌다
            if isinstance(error, ChildAccessDenied | ChildNotFound):
                draft = None
            results.append(
                PublicationResult(
                    draft_id=item.draft_id,
                    child_id=draft.child_id if draft else None,
                    status="failed",
                    parent_note_id=None,
                    version=draft.version if draft else None,
                    published_at=None,
                    error_code=error.code,
                )
            )
    return PublishResponse(results=results)


def _publish_one(
    db: Session,
    item: PublishItem,
    request: PublishRequest,
    teacher_id: UUID,
    center_id: UUID | None,
) -> PublicationResult:
    draft = _draft_for_teacher(db, item.draft_id, center_id)
    if draft.doc_type != DocType.PARENT_NOTE.value:
        raise NotParentNote("알림장만 학부모에게 게시할 수 있습니다.")
    repeated = _publication_of(db, request.request_id, draft.id)
    if repeated is not None:
        return _published_result(draft, repeated)
    if not organization_service.has_linked_parent(db, draft.child_id):
        raise NoLinkedParent("알림장을 받을 보호자가 연결되지 않은 원아입니다.")
    try:
        _claim_version(
            db,
            draft.id,
            expected_version=item.expected_version,
            from_status=DraftStatus.APPROVED,
            wrong_status=lambda _: DraftNotApproved("승인된 알림장만 게시할 수 있습니다."),
            values={},
            unless_exists=(
                _active_publication_exists(),
                DraftAlreadyPublished("이미 게시 중입니다."),
            ),
        )
    except AidamError:
        # 같은 요청이 동시에 두 번 와서 먼저 온 쪽이 게시했다면 그 결과를 돌려준다(멱등).
        repeated = _publication_of(db, request.request_id, draft.id)
        if repeated is not None:
            return _published_result(draft, repeated)
        raise
    round_number = (
        db.scalar(
            select(func.max(DocumentPublication.round_number)).where(
                DocumentPublication.draft_id == draft.id
            )
        )
        or 0
    ) + 1
    published_at = datetime.now(UTC)
    publication = DocumentPublication(
        draft_id=draft.id,
        round_number=round_number,
        publish_request_id=request.request_id,
        published_version=item.expected_version + 1,
        published_at=published_at,
        revoke_deadline=published_at + _REVOKE_WINDOW,
        include_photos=request.include_photos,
    )
    db.add(publication)
    if round_number > 1:
        # 회수 뒤 다시 게시한 것이다. 최초 게시는 DocumentPublication이 기록이라 이력을 따로
        # 남기지 않는다 (테크스펙 RevisionLog.action에 최초 게시 값이 없음).
        db.add(
            RevisionLog(draft_id=draft.id, editor_id=teacher_id, action=RevisionAction.RESEND.value)
        )
    db.commit()
    return _published_result(draft, publication)


def _publication_of(db: Session, request_id: str, draft_id: UUID) -> DocumentPublication | None:
    return db.scalar(
        select(DocumentPublication).where(
            DocumentPublication.publish_request_id == request_id,
            DocumentPublication.draft_id == draft_id,
        )
    )


def _active_publication_exists() -> Exists:
    """활성 게시 회차가 있다 — 학부모에게 지금 보이는 중이다."""
    return exists().where(
        DocumentPublication.draft_id == DraftDocument.id, _is_active_publication()
    )


def _published_result(draft: DraftDocument, publication: DocumentPublication) -> PublicationResult:
    return PublicationResult(
        draft_id=draft.id,
        child_id=draft.child_id,
        status="published",
        parent_note_id=draft.id,
        version=publication.published_version,
        published_at=publication.published_at,
        error_code=None,
    )


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
    raise NotImplementedError("게시 회수 처리 구현 예정")


def list_letters_for_parent(
    db: Session, *, child_id: UUID, parent_id: UUID, limit: int, cursor: str | None
) -> ParentNoteListResponse:
    """학부모가 자녀의 게시된 알림장 목록을 본다 (FR-09, H-1).

    - 단일 게이트(_parent_notes)를 통과한 게시본만 기록 날짜 최신순으로 담는다.
    - 목록에도 미리보기와 사진이 보이므로 담은 알림장마다 AccessLog(view_list)를 남기고,
      기록을 커밋한 뒤에 돌려준다 — 임시 결정(한상균), docs/api/documents.md. 목록은 회수
      판단용 first_viewed_at을 건드리지 않는다.
    - is_read·unread_count는 이 학부모가 본문을 연 적이 있는지(AccessLog view_detail)로 센다.
    """
    notes = _parent_notes(db, parent_id=parent_id, child_id=child_id)
    after = _decode_cursor(cursor)
    remaining = [note for note in notes if after is None or note[0].record_date < after]
    page = remaining[:limit]
    viewed = audit_service.viewed_target_ids(
        db,
        actor_type="parent",
        actor_id=parent_id,
        target_type="document_publication",
        action="view_detail",
        target_ids=[publication.id for _, publication in notes],
    )
    previews = _previews(db, [draft.id for draft, _ in page])
    photos = _parent_photos(db, page, max_per_note=_LIST_PHOTOS_PER_NOTE)
    this_month = datetime.now(_KST).date().replace(day=1)
    response = ParentNoteListResponse(
        items=[
            ParentNoteSummary(
                parent_note_id=draft.id,
                record_date=draft.record_date,
                published_at=publication.published_at,
                preview=previews.get(draft.id, ""),
                photos=photos[draft.id],
                is_read=publication.id in viewed,
            )
            for draft, publication in page
        ],
        next_cursor=_encode_cursor(page[-1][0].record_date) if len(remaining) > limit else None,
        unread_count=sum(publication.id not in viewed for _, publication in notes),
        this_month_count=sum(draft.record_date >= this_month for draft, _ in notes),
    )
    _record_parent_views(db, parent_id, [publication.id for _, publication in page], "view_list")
    return response


def get_letter_for_parent(
    db: Session, *, letter_id: UUID, parent_id: UUID
) -> ParentNoteDetailResponse:
    """학부모가 게시된 알림장 본문을 연다 (FR-09, FR-26, H-1, NFR-05).

    - 없음·미게시·남의 자녀 것을 구분하지 않고 모두 404다. 졸업 후 1년이 지났으면 403이다.
    - "보여 줘도 되는가"와 first_viewed_at 기록을 UPDATE 한 문장으로 합친다 — 그 사이 회수가
      끼면 보여 주지 않는다 (모듈 docstring "열람·회수 공통 주의사항").
    - AccessLog(view_detail)를 같은 트랜잭션에서 커밋한 뒤에만 본문을 돌려준다. 기록에
      실패하면 본문 없이 500이다 (audit/CLAUDE.md).
    """
    draft = db.get(DraftDocument, letter_id)
    if draft is None:
        raise ParentNoteNotFound("알림장을 찾을 수 없습니다.")
    try:
        notes = _parent_notes(db, parent_id=parent_id, child_id=draft.child_id)
    except ChildAccessDenied:
        raise ParentNoteNotFound("알림장을 찾을 수 없습니다.") from None
    index = next((i for i, (note, _) in enumerate(notes) if note.id == letter_id), None)
    if index is None:
        raise ParentNoteNotFound("알림장을 찾을 수 없습니다.")
    publication = notes[index][1]
    result = db.execute(
        update(DocumentPublication)
        .where(DocumentPublication.id == publication.id, _is_active_publication())
        .values(
            first_viewed_at=func.coalesce(DocumentPublication.first_viewed_at, datetime.now(UTC))
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        db.rollback()
        raise ParentNoteNotFound("알림장을 찾을 수 없습니다.")
    sentences = db.scalars(
        select(DraftSentence.text)
        .where(DraftSentence.draft_id == letter_id)
        .order_by(DraftSentence.position)
    )
    content = "\n".join(sentences)
    photos = _parent_photos(db, [notes[index]], max_per_note=None)[letter_id]
    _record_parent_views(db, parent_id, [publication.id], "view_detail")
    older = notes[index + 1][0] if index + 1 < len(notes) else None
    newer = notes[index - 1][0] if index > 0 else None
    return ParentNoteDetailResponse(
        parent_note_id=draft.id,
        child_id=draft.child_id,
        record_date=draft.record_date,
        content=content,
        photos=photos,
        # TODO(한상균): 작성 교사 이름은 auth 조회 함수가 생기면 채운다(FR-26). FE 타입이 문자열이다.
        author_name="",
        published_at=publication.published_at,
        prev=ParentNoteLink(parent_note_id=older.id, record_date=older.record_date)
        if older
        else None,
        next=ParentNoteLink(parent_note_id=newer.id, record_date=newer.record_date)
        if newer
        else None,
    )


def _parent_notes(
    db: Session, *, parent_id: UUID, child_id: UUID
) -> list[tuple[DraftDocument, DocumentPublication]]:
    """학부모에게 보여도 되는 알림장 — 학부모 노출의 단일 게이트다 (H-1, documents/CLAUDE.md).

    네 가지를 함께 본다: 학부모–원아 관계와 NFR-03 열람 기간(organization), 승인됨, 회수되지
    않은 게시 회차, 알림장(관찰일지는 학부모에게 가지 않음). 학부모 응답은 이 함수가 돌려준
    것만 쓴다. 기록 날짜 최신순이다.
    """
    organization_service.ensure_parent_child_access(db, parent_id, child_id)
    rows = db.execute(
        select(DraftDocument, DocumentPublication)
        .join(
            DocumentPublication,
            (DocumentPublication.draft_id == DraftDocument.id) & _is_active_publication(),
        )
        .where(
            DraftDocument.child_id == child_id,
            DraftDocument.status == DraftStatus.APPROVED.value,
            DraftDocument.doc_type == DocType.PARENT_NOTE.value,
        )
        .order_by(DraftDocument.record_date.desc())
    )
    return list(rows.tuples())


def _parent_photos(
    db: Session,
    notes: Sequence[tuple[DraftDocument, DocumentPublication]],
    *,
    max_per_note: int | None,
) -> dict[UUID, list[MediaUrl]]:
    """게시 때 사진을 함께 보내기로 한 알림장만 선택 사진의 서명 URL을 싣는다. 한 번에 서명한다.

    볼 때마다 고를 때와 같은 범위로 다시 거른다. media는 동의 철회를 저장된 값을 고치지 않고
    조회할 때 빼므로, 게시 뒤 함께 찍힌 아이가 ③을 철회하면 그 사진은 더 나가지 않는다(#174 리뷰).
    """
    chosen: dict[UUID, list[UUID]] = {}
    for draft, publication in notes:
        if not publication.include_photos:
            chosen[draft.id] = []
            continue
        shareable = _shareable_photo_ids(db, draft.child_id, draft.record_date)
        selected = [UUID(media_id) for media_id in draft.selected_media_ids]
        chosen[draft.id] = [m for m in selected if m in shareable][:max_per_note]
    signed = {
        photo.media_id: photo
        for photo in _signed_media(
            db, list(dict.fromkeys(m for ids in chosen.values() for m in ids))
        )
    }
    return {
        draft_id: [signed[media_id] for media_id in media_ids if media_id in signed]
        for draft_id, media_ids in chosen.items()
    }


def _record_parent_views(
    db: Session, parent_id: UUID, publication_ids: Sequence[UUID], action: str
) -> None:
    """학부모 열람을 남기고 커밋한다. 실패하면 응답하지 않도록 드러낸다 (NFR-05, audit/CLAUDE.md).

    로그에는 ID만 남긴다 (H-4). target은 게시 회차다 — 임시 결정(한상균).
    """
    try:
        for publication_id in publication_ids:
            audit_service.record_access(
                db,
                actor_type="parent",
                actor_id=parent_id,
                target_type="document_publication",
                target_id=publication_id,
                action=action,
            )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise AccessLogFailed("열람 기록을 남기지 못해 알림장을 보여 드릴 수 없습니다.") from None


def _encode_cursor(record_date: date) -> str:
    return base64.urlsafe_b64encode(record_date.isoformat().encode()).decode()


def _decode_cursor(cursor: str | None) -> date | None:
    """다음 쪽은 이 기록 날짜보다 오래된 알림장부터다. 한 자녀의 알림장은 날짜마다 하나다."""
    if cursor is None:
        return None
    try:
        return date.fromisoformat(base64.urlsafe_b64decode(cursor.encode()).decode())
    except ValueError:
        raise InvalidCursor("목록 위치를 읽을 수 없습니다.") from None
