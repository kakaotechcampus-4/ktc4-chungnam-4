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

해결: "판단"과 "쓰기"를 하나의 UPDATE 문으로 합치고, 상대가 쓰는 필드를 WHERE에
넣는다 — rowcount가 곧 판단 결과다. 학부모가 열어 봤어도 회수하므로(11/05 팀 논의,
#266) 회수는 first_viewed_at을 보지 않는다. 지켜야 하는 것은 "회수 뒤에는 보여 주지
않는다" 한 방향이고, 열람의 WHERE에 있는 revoked_at이 그것을 막는다.

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
            DocumentPublication.revoke_deadline > now,
        )
        .values(revoked_at=now)
    )
    if result.rowcount == 0:
        raise Conflict()  # 이미 회수됐거나 기한이 지났다는 뜻

두 UPDATE가 같은 행을 대상으로 하므로, 회수가 먼저 커밋되면 나중에 온 열람의 WHERE는
그 사이 채워진 revoked_at 때문에 자동으로 막힌다 — PostgreSQL READ COMMITTED(기본 격리
수준)에서 UPDATE는 행 락을 잡은 뒤 WHERE를 커밋된 최신값으로 재평가하기 때문이다.
열람이 먼저 커밋돼도 회수는 막히지 않는다(학부모는 회수 전에 본 것이다).
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
from dataclasses import dataclass
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
    DraftNotPublished,
    DraftNotReady,
    DraftRevoked,
    DraftVersionConflict,
    InvalidCursor,
    InvalidSentenceId,
    MediaAssetNotFound,
    MediaNotLinkedToChild,
    NoLinkedParent,
    NotParentNote,
    ParentNoteNotFound,
    RequestValidationFailed,
    RevokeDeadlinePassed,
)

# agents도 documents를 import한다(save_draft). 순환이라 이름이 아니라 모듈째 import한다 — 이름을 직접
# import하면 import 순서에 따라 깨진다. import-linter를 도입하면 이 순환을 예외로 적는다.
from domains.agents import service as agents_service
from domains.audit import service as audit_service
from domains.auth.service import get_teacher_names
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
    EditMethod,
    RevisionAction,
    RevisionLog,
    UnclassifiedItem,
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
    ParentMediaDay,
    ParentMediaDownloadResponse,
    ParentMediaItem,
    ParentMediaListResponse,
    ParentNoteDetailResponse,
    ParentNoteLink,
    ParentNoteListResponse,
    ParentNoteSummary,
    PublicationResult,
    PublishItem,
    PublishRequest,
    PublishResponse,
    RevokeResponse,
    SelectableMediaItem,
    SelectableMediaListResponse,
    UnclassifiedSummary,
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
# 학부모에게 보내는 미디어 종류 (FR-10). 음성메모는 보내지 않는다.
_PARENT_MEDIA_TYPES = frozenset({"photo", "video"})
# 학부모 사진·영상 모아 보기의 한 쪽 알림장 수 (임시 결정(김동건)).
MEDIA_NOTES_PER_PAGE_MAX = 30
PARENT_SEARCH_MAX_LENGTH = 100  # 학부모 알림장·사진 검색어 길이 — 임시 결정(송유진)
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
            DraftDocument.ai_version,
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
        ai_version=row.ai_version,
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
    draft = (
        _insert_draft(db, data)
        if expected_version is None
        else _update_generated_draft(db, data, expected_version=expected_version)
    )
    resolve_unclassified(db, draft.child_id, draft.record_date, doc_type=data.doc_type)
    return draft


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
        selected_media_ids=[str(media_id) for media_id in data.selected_media_ids],
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
    draft = db.get(DraftDocument, data.draft_id, populate_existing=True)
    # 이미 고른 사진은 그대로 두고 새 근거 사진만 뒤에 더한다. 교사가 골라 둔 순서를 AI가 바꾸지 않는다.
    # 임시 결정(정은): 교사가 빼 둔 사진이 다시 근거가 되면 다시 들어온다 — 선택 변경은 RevisionLog에
    # 남지 않아 뺀 것인지 처음부터 없던 것인지 알 수 없다.
    kept = list(draft.selected_media_ids)
    added = [str(m) for m in data.selected_media_ids if str(m) not in kept]
    if added:
        draft.selected_media_ids = kept + added
        db.flush()
    return draft


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
            section=sentence.section,
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
    - 그날 초안 또는 열린 알림장 실패가 있는 원아를 명단 순서대로 담는다.
      "자료 없음" 행은 FE가 명단과 비교해 만든다.
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
    publications = _active_publication_rows(db, [draft.id for draft, _ in latest.values()])

    documents_by_child: dict[UUID, dict[str, DraftSummary]] = {}
    for (child_id, draft_doc_type), (draft, published_at) in latest.items():
        publication = publications.get(draft.id)
        documents_by_child.setdefault(child_id, {})[draft_doc_type] = DraftSummary(
            draft_id=draft.id,
            status=DraftStatus(draft.status),
            version=draft.version,
            published_at=published_at,
            revoke_deadline=publication.revoke_deadline if publication else None,
            can_revoke=_can_revoke(publication),
            preview=previews.get(draft.id, ""),
        )
    failures = (
        {}
        if published
        else {
            row.child_id: UnclassifiedSummary(reason=row.reason)
            for row in db.scalars(
                select(UnclassifiedItem).where(
                    UnclassifiedItem.child_id.in_(child_ids),
                    UnclassifiedItem.record_date == record_date,
                    UnclassifiedItem.status == "open",
                    ~select(DraftDocument.id)
                    .where(
                        DraftDocument.child_id == UnclassifiedItem.child_id,
                        DraftDocument.record_date == UnclassifiedItem.record_date,
                        DraftDocument.doc_type == DocType.PARENT_NOTE.value,
                    )
                    .exists(),
                )
            )
        }
    )
    return ClassDraftListResponse(
        items=[
            ClassDraftItem(
                child_id=child_id,
                unclassified=failures.get(child_id),
                **documents_by_child.get(child_id, {}),
            )
            for child_id in child_ids
            if child_id in documents_by_child or child_id in failures
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
    publications = _active_publication_rows(db, [draft.id for draft, _ in rows])
    return ChildDraftListResponse(
        items=[
            ChildDraftItem(
                draft_id=draft.id,
                record_date=draft.record_date,
                status=DraftStatus(draft.status),
                version=draft.version,
                published_at=published_at,
                revoke_deadline=(
                    publications[draft.id].revoke_deadline if draft.id in publications else None
                ),
                can_revoke=_can_revoke(publications.get(draft.id)),
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


def _active_publication_rows(
    db: Session, draft_ids: Sequence[UUID]
) -> dict[UUID, DocumentPublication]:
    """초안별 활성 게시 회차 행. 여럿이면 _active_publications()처럼 가장 최근 것이다.

    목록의 회수 기한·회수 가능 여부용이다. 한 번에 읽어 목록 길이만큼 쿼리가 늘지 않는다.
    """
    if not draft_ids:
        return {}
    rows = db.scalars(
        select(DocumentPublication)
        .where(DocumentPublication.draft_id.in_(draft_ids), _is_active_publication())
        .order_by(DocumentPublication.published_at.desc())
    )
    latest: dict[UUID, DocumentPublication] = {}
    for row in rows:
        latest.setdefault(row.draft_id, row)
    return latest


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

    - 알림장을 직접 쓰면 같은 원아·날짜의 실패도 해소하고 처리 교사를 남긴다 (#196).
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
    resolve_unclassified(
        db, child_id, request.record_date, doc_type=request.doc_type, resolved_by=teacher_id
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
    """알림장 사진·영상은 그 원아·그 날짜에 학부모에게 보여도 되는 것 중에서만 고른다."""
    if not set(media_ids) <= _shareable_media_ids(db, draft.child_id, draft.record_date):
        raise MediaNotLinkedToChild("이 원아의 그날 사진·영상만 고를 수 있습니다.")


def _shareable_media_ids(db: Session, child_id: UUID, record_date: date) -> set[UUID]:
    """고를 때와 보여 줄 때 판정하는 범위. 정의는 _shareable_media 하나다."""
    return {media.media_id for media in _shareable_media(db, child_id, record_date)}


def _shareable_media(
    db: Session, child_id: UUID, record_date: date
) -> list[media_service.MediaMeta]:
    """그 원아·그 날짜에 학부모에게 보여도 되는 사진·영상. 고를 때와 보여 줄 때 같은 범위를 쓴다.

    교사가 그 원아에게 귀속시킨 사진·영상이면 다른 아이가 함께 찍혀도 된다(FR-10). 함께 찍힌
    아이의 촬영·공유는 필수 동의(②) 범위로 보고, ③(얼굴특징정보) 동의와 llm_allowed는 LLM
    경로에서만 본다(H-2). 무엇을 보낼지는 교사가 고르고 승인한다(H-1). 음성메모는 보내지 않는다.
    테크스펙 D-4(11/04 팀 승인, open-questions 57번). 이전 범위는 llm_allowed·귀속 원아 전원 ③
    동의였다(임시 결정(한상균)). 촬영 순서다.
    """
    return media_service.list_child_media(db, child_id, record_date, types=_PARENT_MEDIA_TYPES)


def list_selectable_media(
    db: Session, *, draft_id: UUID, teacher_id: UUID, center_id: UUID | None
) -> SelectableMediaListResponse:
    """교사가 이 알림장에 고를 수 있는 사진·영상 후보를 본다 (FR-10, 테크스펙 D-4).

    - 초안 상세의 media에는 선택·근거·실패 사진만 와서 후보를 따로 준다 (#257 멘토 리뷰).
    - 권한은 get_draft_for_teacher와 같다. 후보를 보는 것은 검수이고, 학부모에게 나가려면 고른 뒤
      승인·게시해 _parent_notes 게이트를 지나야 한다 (H-1).
    - 촬영 순서다. 거른 뒤 서명 전에 파기된 것은 서명이 뺀다.
    - 아이 사진의 서명 URL을 주는 열람이라 AccessLog(teacher, draft_document,
      view_selectable_media)를 커밋한 뒤 돌려준다 — NFR-05, 임시 결정(송유진). 기록에 실패하면
      URL 없이 500이다.
    """
    draft = _draft_for_teacher(db, draft_id, center_id)
    if draft.doc_type != DocType.PARENT_NOTE.value:
        raise NotParentNote("알림장에만 사진을 고를 수 있습니다.")
    captured_at_by_media = {
        media.media_id: media.captured_at
        for media in _shareable_media(db, draft.child_id, draft.record_date)
    }
    items = [
        SelectableMediaItem(
            media_id=signed.media_id,
            type=signed.type,
            url=signed.url,
            url_expires_at=signed.url_expires_at,
            captured_at=captured_at_by_media[signed.media_id],
        )
        for signed in _signed_media(db, list(captured_at_by_media))
    ]
    try:
        audit_service.record_access(
            db,
            actor_type="teacher",
            actor_id=teacher_id,
            target_type="draft_document",
            target_id=draft_id,
            action="view_selectable_media",
        )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise AccessLogFailed("열람 기록을 남기지 못해 사진을 보여 드릴 수 없습니다.") from None
    return SelectableMediaListResponse(items=items)


def _not_editable(status: str) -> AidamError:
    if status == DraftStatus.DRAFT.value:
        return DraftNotReady("초안을 만드는 중입니다. 다 만들어진 뒤에 고칠 수 있습니다.")
    if status == DraftStatus.REVOKED.value:
        return DraftRevoked("회수한 알림장입니다. 다시 검토로 돌린 뒤에 고칠 수 있습니다.")
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
    """승인 또는 회수를 되돌려 다시 검토하게 한다 (임시 결정(김진하·한상균), docs/api/documents.md).

    학부모에게 게시된 초안은 되돌리지 않는다 — 이미 나갔으므로 회수가 따로 필요하다 (H-1).
    읽어 둔 상태로 시작 상태를 고르지만, 그 사이 상태가 바뀌면 버전이 달라 _claim_version이 막는다.
    """
    draft = _draft_for_teacher(db, draft_id, center_id)
    is_revoked = draft.status == DraftStatus.REVOKED.value
    _change_status(
        db,
        draft_id,
        teacher_id=teacher_id,
        expected_version=expected_version,
        from_status=DraftStatus.REVOKED if is_revoked else DraftStatus.APPROVED,
        to_status=DraftStatus.VERIFIED,
        action=RevisionAction.REOPEN,
        wrong_status=lambda _: DraftNotApproved("승인했거나 회수한 초안만 되돌릴 수 있습니다."),
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
    (#206 멘토 리뷰). 커밋 전이라도 같은 트랜잭션이라 방금 쓴 값을 읽는다 — 단 세션이
    autoflush를 끄고 있어(core/database.py) 조회 전에 직접 flush해야 새로 add한 문장이 보인다.
    """
    try:
        db.flush()
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

    - 작성 교사 이름은 auth.get_teacher_names로 조회한다. LLM 입력에는 넣지 않는다.
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
    failed_media_ids = agents_service.list_failed_photo_ids(db, draft.evidence_bundle_id)
    evidences_by_sentence = agents_service.list_sentence_evidences(db, draft_id)
    views = [
        DraftSentenceView(
            section=sentence.section,
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
        sections=(
            agents_service.observation_log_sections()
            if draft.doc_type == DocType.OBSERVATION_LOG.value
            else []
        ),
        sentences=views,
        daily_routine=agents_service.get_daily_routine(db, draft.evidence_bundle_id),
        selected_media_ids=selected_media_ids,
        failed_media_ids=failed_media_ids,
        media=_signed_media(
            db, list(dict.fromkeys(selected_media_ids + evidence_media_ids + failed_media_ids))
        ),
        author_teacher_id=draft.author_teacher_id,
        author_name=get_teacher_names(db, [draft.author_teacher_id]).get(
            draft.author_teacher_id, ""
        ),
        approved_at=draft.approved_at,
        published_at=publication.published_at if publication else None,
        include_photos=publication.include_photos if publication else None,
        revoke_deadline=publication.revoke_deadline if publication else None,
        can_revoke=_can_revoke(publication),
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
    db: Session, *, draft_id: UUID, teacher_id: UUID, center_id: UUID | None, expected_version: int
) -> RevokeResponse:
    """게시한 알림장을 회수한다 (테크스펙 파이프라인 9단계, H-1, docs/api/documents.md).

    - 회수 자격(미회수·기한 이내)은 회차 UPDATE 한 문장으로 판단한다. 학부모가 열어 봤어도
      회수한다 — 잘못 나간 알림장을 학부모가 먼저 열면 고칠 길이 없어서다(11/05 팀 논의, #266).
      회수가 먼저 커밋되면 그 뒤의 열람은 막힌다 (모듈 docstring "열람·회수 공통 주의사항").
    - 회차 갱신과 초안 상태 전이·RevisionLog는 한 트랜잭션이다. 버전이 달라 전이가 실패하면
      _claim_version이 롤백해 회차도 그대로 남는다.
    """
    _draft_for_teacher(db, draft_id, center_id)
    publication_id = db.scalar(
        select(DocumentPublication.id).where(
            DocumentPublication.draft_id == draft_id, _is_active_publication()
        )
    )
    if publication_id is None:
        raise DraftNotPublished("게시 중인 알림장이 아닙니다.")
    revoked_at = datetime.now(UTC)
    result = db.execute(
        update(DocumentPublication)
        .where(
            DocumentPublication.id == publication_id,
            _is_active_publication(),
            DocumentPublication.revoke_deadline > revoked_at,
        )
        .values(revoked_at=revoked_at)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        db.rollback()
        raise _not_revocable(db, publication_id)
    _change_status(
        db,
        draft_id,
        teacher_id=teacher_id,
        expected_version=expected_version,
        from_status=DraftStatus.APPROVED,
        to_status=DraftStatus.REVOKED,
        action=RevisionAction.REVOKE,
        wrong_status=lambda _: DraftNotPublished("게시 중인 알림장이 아닙니다."),
    )
    # develop의 _change_status는 커밋하지 않는다(#214). 빠뜨리면 성공으로 답하고도 회수가 사라진다.
    db.commit()
    return RevokeResponse(
        draft_id=draft_id,
        publication_id=publication_id,
        revoked_at=revoked_at,
        version=expected_version + 1,
    )


def _not_revocable(db: Session, publication_id: UUID) -> AidamError:
    """회수 UPDATE가 0행일 때 이유를 다시 읽어 예외로 바꾼다. 읽기만 한다."""
    publication = db.get(DocumentPublication, publication_id, populate_existing=True)
    if publication.revoked_at is not None:
        return DraftNotPublished("이미 회수한 알림장입니다.")
    return RevokeDeadlinePassed("회수 기한(게시 후 24시간)이 지났습니다.")


def _can_revoke(publication: DocumentPublication | None) -> bool:
    """상세 응답용. 실제 판단은 revoke_publication의 UPDATE가 한다."""
    if publication is None:
        return False
    deadline = publication.revoke_deadline
    # SQLite는 시간대를 저장하지 않는다. DB에는 UTC로 저장한다(backend/CLAUDE.md).
    return (deadline if deadline.tzinfo else deadline.replace(tzinfo=UTC)) > datetime.now(UTC)


def list_letters_for_parent(
    db: Session,
    *,
    child_id: UUID,
    parent_id: UUID,
    limit: int,
    cursor: str | None,
    keyword: str | None = None,
) -> ParentNoteListResponse:
    """학부모가 자녀의 게시된 알림장 목록을 본다 (FR-09, H-1).

    - 단일 게이트(_parent_notes)를 통과한 게시본만 기록 날짜 최신순으로 담는다.
    - 목록에도 미리보기와 사진이 보이므로 담은 알림장마다 AccessLog(view_list)를 남기고,
      기록을 커밋한 뒤에 돌려준다 — 임시 결정(한상균), docs/api/documents.md. 목록은 본문을
      처음 연 시각인 first_viewed_at을 건드리지 않는다.
    - is_read·unread_count는 이 학부모가 본문을 연 적이 있는지(AccessLog view_detail)로 센다.
    - keyword가 있으면 본문·날짜에 그 말이 든 알림장만 담는다(_matching_notes). unread_count와
      this_month_count는 검색과 상관없이 전체를 센다 — 임시 결정(송유진), docs/api/documents.md.
    """
    notes = _parent_notes(db, parent_id=parent_id, child_id=child_id)
    after = _decode_cursor(cursor)
    remaining = [
        note
        for note in _matching_notes(db, notes, keyword)
        if after is None or note[0].record_date < after
    ]
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
                is_resent=_is_resent(publication),
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
        author_name=get_teacher_names(db, [draft.author_teacher_id]).get(
            draft.author_teacher_id, ""
        ),
        published_at=publication.published_at,
        is_resent=_is_resent(publication),
        prev=ParentNoteLink(parent_note_id=older.id, record_date=older.record_date)
        if older
        else None,
        next=ParentNoteLink(parent_note_id=newer.id, record_date=newer.record_date)
        if newer
        else None,
    )


def list_media_for_parent(
    db: Session,
    *,
    child_id: UUID,
    parent_id: UUID,
    limit: int,
    cursor: str | None,
    keyword: str | None = None,
) -> ParentMediaListResponse:
    """학부모가 자녀의 사진·영상을 알림장 날짜별로 모아 본다 (FR-10, H-1).

    - 알림장 게이트(_parent_notes)를 통과한 게시본 중 사진을 함께 보내기로 한 것에서, 교사가
      고른 사진·영상만 싣는다(_parent_note_media_ids). 교사가 승인하지 않은 것은 나가지 않는다.
    - 보낼 것이 없는 알림장은 건너뛰고, 기록 날짜 최신순으로 limit개 알림장씩 나눈다.
    - 화면에 실린 알림장마다 AccessLog(view_media)를 커밋한 뒤 돌려준다 — 임시 결정(김동건).
      목록과 같이 first_viewed_at은 건드리지 않는다(본문을 처음 연 시각이라서).
    - 사진에는 글이 없어 keyword는 함께 게시한 알림장의 본문·날짜에서 찾는다(_matching_notes).
      그때 photo_count·video_count는 찾은 알림장 안에서 센다 — 임시 결정(송유진).
    """
    notes = _matching_notes(db, _parent_notes(db, parent_id=parent_id, child_id=child_id), keyword)
    note_media = _parent_note_media_ids(db, notes)
    with_media = [(draft, publication) for draft, publication in notes if note_media[draft.id]]
    after = _decode_cursor(cursor)
    remaining = [note for note in with_media if after is None or note[0].record_date < after]
    page = remaining[:limit]

    meta = media_service.get_media_meta(
        db, list(dict.fromkeys(m for ids in note_media.values() for m in ids))
    )
    page_ids = list(dict.fromkeys(m for draft, _ in page for m in note_media[draft.id]))
    signed = {item.media_id: item for item in media_service.get_signed_urls(db, page_ids)}
    # 서명은 파기된 미디어를 뺀다. 거른 뒤 서명 전에 파기된 것도 개수에서 빼 그리드와 맞춘다.
    counted = [
        item for item in meta.values() if item.media_id not in page_ids or item.media_id in signed
    ]
    response = ParentMediaListResponse(
        days=[
            ParentMediaDay(
                parent_note_id=draft.id,
                record_date=draft.record_date,
                items=[
                    ParentMediaItem(
                        media_id=media_id,
                        type=meta[media_id].type,
                        captured_at=meta[media_id].captured_at,
                        url=signed[media_id].url,
                        url_expires_at=signed[media_id].url_expires_at,
                    )
                    for media_id in note_media[draft.id]
                    if media_id in signed
                ],
            )
            for draft, _ in page
        ],
        next_cursor=_encode_cursor(page[-1][0].record_date) if len(remaining) > limit else None,
        photo_count=sum(item.type == "photo" for item in counted),
        video_count=sum(item.type == "video" for item in counted),
    )
    _record_parent_views(db, parent_id, [publication.id for _, publication in page], "view_media")
    return response


def get_media_download_for_parent(
    db: Session, *, child_id: UUID, media_id: UUID, parent_id: UUID
) -> ParentMediaDownloadResponse:
    """학부모가 자녀의 사진·영상 원본을 내려받는 URL을 받는다 (FR-10, H-1, NFR-05).

    - 모아 보기와 같은 게이트를 지난 것만 준다. 미게시·미선택·남의 자녀 것을 구분하지 않고
      404(MEDIA_ASSET_NOT_FOUND)다. 학부모–원아 관계가 없거나 열람 기간이 지났으면 403이다.
    - AccessLog(download, 대상 media_asset)를 커밋한 뒤에만 URL을 돌려준다 — 임시 결정(김동건).
    """
    notes = _parent_notes(db, parent_id=parent_id, child_id=child_id)
    # 그 미디어를 고른 알림장만 다시 거른다. 전부 거르면 알림장 수만큼 media를 조회한다(#242 리뷰).
    chosen_by = [
        (draft, publication)
        for draft, publication in notes
        if str(media_id) in draft.selected_media_ids
    ]
    note_media = _parent_note_media_ids(db, chosen_by)
    if not any(media_id in ids for ids in note_media.values()):
        raise MediaAssetNotFound("사진·영상을 찾을 수 없어요.")
    download = media_service.get_download_url(db, media_id)
    _record_parent_views(
        db, parent_id, [media_id], "download", target_type=media_service.AUDIT_TARGET_TYPE
    )
    return ParentMediaDownloadResponse(
        media_id=download.media_id,
        type=download.type,
        url=download.url,
        url_expires_at=download.url_expires_at,
        filename=download.filename,
    )


def _is_resent(publication: DocumentPublication) -> bool:
    """회수 뒤 다시 보낸 회차인가. 게시는 활성 회차가 없을 때만 되므로 2회째부터가 다시 보낸 것이다.

    학부모 화면의 "선생님이 내용을 고쳤어요"에 쓴다 — 먼저 본 학부모가 바뀐 것을 알게 하려는
    것이다(11/05 팀 논의, #266). 전 회차를 본 학부모만 가르지 않는다 — 임시 결정(한상균).
    """
    return publication.round_number > 1


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


def _matching_notes(
    db: Session,
    notes: Sequence[tuple[DraftDocument, DocumentPublication]],
    keyword: str | None,
) -> list[tuple[DraftDocument, DocumentPublication]]:
    """게이트를 지난 알림장 가운데 본문의 한 문장이나 날짜에 keyword가 든 것만 남긴다 (FR-09, FR-10).

    게이트(_parent_notes)의 결과만 거르므로 보여도 되는 범위를 넓히지 않는다 (H-1). 검색어가
    비었으면 그대로 돌려준다. 띄어쓰기와 대소문자는 가리지 않는다. 문장마다 따로 찾아서, 앞 문장
    끝과 다음 문장 앞이 붙어 글에 없는 말이 찾히지 않게 한다. 아이 한 명의 게시본 안에서만 찾아
    양이 적으므로 파이썬에서 거른다. 검색어는 로그와 AccessLog에 남기지 않는다 (H-4).
    """
    needle = _search_key(keyword or "")
    if not needle:
        return list(notes)
    sentences: dict[UUID, list[str]] = {}
    rows = db.execute(
        select(DraftSentence.draft_id, DraftSentence.text).where(
            DraftSentence.draft_id.in_([draft.id for draft, _ in notes])
        )
    )
    for draft_id, text in rows:
        sentences.setdefault(draft_id, []).append(text)
    return [
        (draft, publication)
        for draft, publication in notes
        if any(
            needle in _search_key(text)
            for text in (_date_search_text(draft.record_date), *sentences.get(draft.id, []))
        )
    ]


def _search_key(text: str) -> str:
    return "".join(text.split()).casefold()


def _date_search_text(record_date: date) -> str:
    """화면의 날짜 표기("2026년 11월 7일 토요일")와 ISO 표기 둘 다로 찾을 수 있게 한다."""
    weekday = "월화수목금토일"[record_date.weekday()]
    return (
        f"{record_date.year}년 {record_date.month}월 {record_date.day}일 {weekday}요일 "
        f"{record_date.isoformat()}"
    )


def _parent_photos(
    db: Session,
    notes: Sequence[tuple[DraftDocument, DocumentPublication]],
    *,
    max_per_note: int | None,
) -> dict[UUID, list[MediaUrl]]:
    """게시 때 사진을 함께 보내기로 한 알림장만 선택 사진의 서명 URL을 싣는다. 한 번에 서명한다."""
    chosen = {
        draft_id: media_ids[:max_per_note]
        for draft_id, media_ids in _parent_note_media_ids(db, notes).items()
    }
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


def _parent_note_media_ids(
    db: Session, notes: Sequence[tuple[DraftDocument, DocumentPublication]]
) -> dict[UUID, list[UUID]]:
    """게이트(_parent_notes)를 통과한 알림장마다 학부모에게 보낼 미디어 id. 교사가 고른 순서다.

    사진을 함께 보내기로 게시한 알림장만 싣는다. 볼 때마다 고를 때와 같은 범위(_shareable_media_ids)로
    다시 거른다 — 게시 뒤 귀속이 바뀌거나 파기된 미디어는 더 나가지 않는다(#174 리뷰).
    """
    chosen: dict[UUID, list[UUID]] = {}
    for draft, publication in notes:
        if not publication.include_photos:
            chosen[draft.id] = []
            continue
        shareable = _shareable_media_ids(db, draft.child_id, draft.record_date)
        selected = [UUID(media_id) for media_id in draft.selected_media_ids]
        chosen[draft.id] = [m for m in dict.fromkeys(selected) if m in shareable]
    return chosen


def _record_parent_views(
    db: Session,
    parent_id: UUID,
    target_ids: Sequence[UUID],
    action: str,
    *,
    target_type: str = "document_publication",
) -> None:
    """학부모 열람을 남기고 커밋한다. 실패하면 응답하지 않도록 드러낸다 (NFR-05, audit/CLAUDE.md).

    로그에는 ID만 남긴다 (H-4). target은 게시 회차다 — 임시 결정(한상균). 원본 내려받기만
    미디어(media_asset)를 target으로 남긴다 — 임시 결정(김동건).
    """
    try:
        for target_id in target_ids:
            audit_service.record_access(
                db,
                actor_type="parent",
                actor_id=parent_id,
                target_type=target_type,
                target_id=target_id,
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


def record_unclassified(
    db: Session, *, child_id: UUID, record_date: date, reason: str, job_id: UUID
) -> None:
    """원아·날짜의 열린 실패를 갱신한다. 커밋은 작업 호출자가 한다(#196)."""
    if reason not in {
        "insufficient_evidence",
        "verification_failed",
        "photo_analysis_failed",
        "no_consent",
    }:
        raise ValueError("Unknown generation failure reason")

    # FR-06 / #196: 이미 검토할 알림장이 있으면 재생성 실패로 확인 필요를 만들지 않는다.
    # 과거에 함께 남은 실패도 이 트랜잭션에서 해소하고 기존 문서는 보존한다.
    existing = db.scalar(
        select(DraftDocument.id).where(
            DraftDocument.child_id == child_id,
            DraftDocument.record_date == record_date,
            DraftDocument.doc_type == DocType.PARENT_NOTE.value,
        )
    )
    if existing is not None:
        resolve_unclassified(db, child_id, record_date, doc_type=DocType.PARENT_NOTE)
        return

    def current() -> UnclassifiedItem | None:
        return db.scalar(
            select(UnclassifiedItem).where(
                UnclassifiedItem.child_id == child_id,
                UnclassifiedItem.record_date == record_date,
                UnclassifiedItem.status == "open",
            )
        )

    row = current()
    if row is None:
        try:
            with db.begin_nested():
                row = UnclassifiedItem(
                    child_id=child_id,
                    record_date=record_date,
                    reason=reason,
                    ref_type="job",
                    ref_id=job_id,
                    status="open",
                )
                db.add(row)
                db.flush()
        except IntegrityError:
            row = current()
            if row is None:
                raise
    row.reason = reason
    row.ref_type = "job"
    row.ref_id = job_id
    db.flush()


def resolve_unclassified(
    db: Session,
    child_id: UUID,
    record_date: date,
    *,
    doc_type: DocType,
    resolved_by: UUID | None = None,
) -> None:
    """알림장 저장과 실패 해소를 같은 트랜잭션으로 묶는다(FR-06, #196)."""
    if doc_type != DocType.PARENT_NOTE:
        return
    db.execute(
        update(UnclassifiedItem)
        .where(
            UnclassifiedItem.child_id == child_id,
            UnclassifiedItem.record_date == record_date,
            UnclassifiedItem.status == "open",
        )
        .values(status="resolved", resolved_at=datetime.now(UTC), resolved_by=resolved_by)
    )


@dataclass(frozen=True)
class ChildNoteRecord:
    """원아 상세의 최근 알림장 한 건."""

    parent_note_id: UUID
    record_date: date
    published: bool
    summary: str


@dataclass(frozen=True)
class ChildRecordSummary:
    """organization 원아 상세·개요에 싣는 documents 집계. 도메인 사이 계약이라 타입으로 둡니다."""

    month_record_count: int
    today_note_sent: bool
    recent_notes: tuple[ChildNoteRecord, ...]


_RECENT_NOTE_LIMIT = 10
_EMPTY_NOTE_SUMMARY = "작성 중인 알림장입니다."


def child_record_summary(db: Session, child_id: UUID, today: date) -> ChildRecordSummary:
    """organization 상세용 내부 조회. 호출자는 먼저 원아 접근 권한을 검사합니다 (#231).

    원아·동의 모델을 직접 읽지 않고 documents 소유 기록만 집계합니다. 커밋하지 않습니다.
    `month_record_count`는 이번 달(1일~오늘)의 알림장 수이고, 승인 전·회수한 초안도 셉니다.
    """
    base = select(DraftDocument).where(
        DraftDocument.child_id == child_id,
        DraftDocument.doc_type == DocType.PARENT_NOTE.value,
    )
    month_count = (
        db.scalar(
            select(func.count()).select_from(
                base.where(
                    DraftDocument.record_date >= today.replace(day=1),
                    DraftDocument.record_date <= today,
                ).subquery()
            )
        )
        or 0
    )
    today_sent = (
        db.scalar(
            base.where(
                DraftDocument.record_date == today,
                DraftDocument.status == DraftStatus.APPROVED.value,
                _active_publication_exists(),
            ).limit(1)
        )
        is not None
    )
    rows = db.scalars(
        base.order_by(DraftDocument.record_date.desc()).limit(_RECENT_NOTE_LIMIT)
    ).all()
    draft_ids = [row.id for row in rows]
    # 미리보기는 다른 목록과 같은 규칙(100자, 문장 경계)으로 한 번에 읽습니다.
    previews = _previews(db, draft_ids)
    published_ids = (
        set(
            db.scalars(
                select(DocumentPublication.draft_id).where(
                    DocumentPublication.draft_id.in_(draft_ids), _is_active_publication()
                )
            )
        )
        if draft_ids
        else set()
    )
    recent = tuple(
        ChildNoteRecord(
            parent_note_id=row.id,
            record_date=row.record_date,
            published=row.status == DraftStatus.APPROVED.value and row.id in published_ids,
            summary=previews.get(row.id) or _EMPTY_NOTE_SUMMARY,
        )
        for row in rows
    )
    return ChildRecordSummary(
        month_record_count=month_count,
        today_note_sent=today_sent,
        recent_notes=recent,
    )


@dataclass(frozen=True)
class PublishedEvidence:
    """agents 내부 조회용. 원아·교사 이름은 메타데이터에 포함하지 않는다."""

    document_id: UUID
    record_date: date
    text: str
    version: int


def get_record_dates(db: Session, draft_ids: Sequence[UUID]) -> dict[UUID, date]:
    """문서 ID마다 기록 날짜를 찾아 준다. 없는 ID는 뺀다.

    agents가 월 관찰일지 근거의 알림장 날짜를 채울 때 쓴다(#264, 임시 결정(정은)). 본문·상태는
    읽지 않고 날짜만 돌려주므로 권한 판정은 부르는 쪽(초안 상세)이 이미 했다.
    """
    unique_ids = list(dict.fromkeys(draft_ids))
    if not unique_ids:
        return {}
    rows = db.execute(
        select(DraftDocument.id, DraftDocument.record_date).where(DraftDocument.id.in_(unique_ids))
    ).all()
    return {row.id: row.record_date for row in rows}


def published_records_for_agents(
    db: Session, *, child_id: UUID, start_date: date, end_date: date, lock: bool = False
) -> list[PublishedEvidence]:
    """Job에 묶인 원아·기간의 현재 게시 알림장만 읽는다(FR-06, #225).

    외부 호출 권한은 Job 생성 API가 확인한다. 승인만 된 문서·회수본·타 원아는 제외한다.
    """
    query = (
        select(DraftDocument)
        .where(
            DraftDocument.child_id == child_id,
            DraftDocument.doc_type == DocType.PARENT_NOTE.value,
            DraftDocument.record_date.between(start_date, end_date),
            DraftDocument.status == DraftStatus.APPROVED.value,
            select(DocumentPublication.id)
            .where(
                DocumentPublication.draft_id == DraftDocument.id,
                _is_active_publication(),
            )
            .exists(),
        )
        .order_by(DraftDocument.record_date, DraftDocument.id)
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    rows = db.scalars(query).all()
    if not rows:
        return []
    texts_by_draft: dict[UUID, list[str]] = {row.id: [] for row in rows}
    sentences = db.execute(
        select(DraftSentence.draft_id, DraftSentence.text)
        .where(DraftSentence.draft_id.in_(texts_by_draft))
        .order_by(DraftSentence.draft_id, DraftSentence.position)
    )
    for draft_id, text in sentences:
        texts_by_draft[draft_id].append(text)
    return [
        PublishedEvidence(
            document_id=row.id,
            record_date=row.record_date,
            version=row.version,
            text="\n".join(texts_by_draft[row.id]),
        )
        for row in rows
    ]
