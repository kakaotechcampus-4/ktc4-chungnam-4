"""documents 도메인 ORM 모델.

관찰일지·알림장 초안의 검토·승인·게시·회수, 그리고 공지사항을 다룬다. 공통 규칙은
../../CLAUDE.md, 도메인 규칙은 ./CLAUDE.md 참고. 필드는 docs/테크스펙.md의
"④ 초안 생성·검증", "⑤ 승인·노출·로그", "⑥ 미정 기능 관련" ERD를 따른다.

# TODO(한상균): DocumentPublication(게시 회차)은 테크스펙 ERD에 없는 이 도메인의
#   추가 제안이다. 테크스펙은 승인(approved_at)을 노출 기준 시점으로 보고 회수·재게시를
#   RevisionLog.action(revoke/resend)만으로 표현하는데, 이 파일은 승인과 게시를
#   완전히 분리해 별도 테이블로 관리한다 — docs/open-questions.md "문서 게시 모델"
#   항목 참고, 팀 확정 전까지는 제안 단계다. DraftStatus에 REVOKED가 있는 것도
#   같은 이유(테크스펙 status 값은 draft/verified/approved/unclassified뿐).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class DocType(StrEnum):
    """AI 생성 문서 종류. tools/contracts.py의 DocType과 값은 같지만 별도로 정의한다 —
    documents는 agents 담당의 service.py를 거치지 않고 tools/를 직접 참조할 수 없다
    (backend/CLAUDE.md 계층 규칙: tools/, prompts/는 agents/service.py만 호출)."""

    OBSERVATION_LOG = "observation_log"
    PARENT_NOTE = "parent_note"


class DraftStatus(StrEnum):
    """초안 상태. PUBLISHED는 없다 — 학부모 공개 게이트는 CLAUDE.md H-1에 따라
    `status == APPROVED`로 검사하므로, 게시는 status를 바꾸지 않고 별도로
    `DocumentPublication` 행을 만드는 것으로만 표현한다 (모델은 "승인됐는가"만
    답하고, "지금 공개 중인가"는 활성 DocumentPublication 존재 여부로 판단).

    REVOKED는 게시된 것을 회수했다는 뜻이며, 재게시 전에 반드시 APPROVED로
    재전이(재승인)해야 한다 — "회수 후 수정 → 재승인 → 재게시" 규칙.

    테크스펙 ERD의 값(draft/verified/approved/unclassified)과 다르다 — "verified"는
    AI Critic 검증 통과 여부(별도로 agents.VerificationResult가 추적)라 교사
    검토·승인 워크플로 상태와 축이 다르고, "unclassified"는 이 문서가
    UnclassifiedItem으로 빠졌다는 뜻이라 상태값보다는 ref_type=draft_document인
    UnclassifiedItem 존재 여부로 보는 쪽이 자연스럽다. 이 축소·차이도
    docs/open-questions.md에 제안으로 남긴다.
    """

    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REVOKED = "revoked"


class DraftDocument(Base):
    """관찰일지·알림장 초안 한 건.

    child_id·doc_type·record_date 조합당 하나만 유지한다 — AI 재생성은 새 행이
    아니라 같은 행의 content·ai_version을 갱신하는 것으로 본다.
    """

    __tablename__ = "draft_documents"
    __table_args__ = (
        UniqueConstraint("child_id", "doc_type", "record_date", name="uq_draft_child_type_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # organization.Child 참조 — organization/models.py가 아직 없어 FK 제약은 걸지 않는다.
    child_id = Column(UUID(as_uuid=True), nullable=False)
    # auth.Teacher 참조. 작성 시점 교사를 그대로 남긴다 — 담임이 바뀌어도 유추하지
    # 않는다 (FR-26, documents/CLAUDE.md). 표시용 이름은 서버가 이 FK로 조회해 붙이고
    # LLM 프롬프트에는 넣지 않는다 (H-2).
    author_teacher_id = Column(UUID(as_uuid=True), nullable=False)
    doc_type = Column(String, nullable=False)
    record_date = Column(Date, nullable=False)
    status = Column(String, nullable=False, default=DraftStatus.DRAFT.value)
    content = Column(Text, nullable=False, default="")
    # agents.EvidenceBundle 참조 — 근거 상세는 agents 도메인이 소유, 여기선 추적용 링크만 둔다.
    evidence_bundle_id = Column(UUID(as_uuid=True), nullable=True)
    # AI 생성 회차. tools/contracts.py DraftDocument.version과 대응 — 교사 수정 횟수와는 다르다.
    ai_version = Column(Integer, nullable=False, default=1)
    # 낙관적 잠금용 일반 버전. 교사 수정·승인·게시·회수마다 증가시킨다. 요청에는
    # expected_version을 실어 보내고 불일치하면 충돌로 거부한다 (오래된 화면의
    # 수정이 최신 내용을 덮어쓰는 것을 막기 위함).
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    approved_at = Column(DateTime(timezone=True), nullable=True)


class DocumentPublication(Base):
    """게시 회차 한 건 (테크스펙 ERD에 없는 이 도메인의 추가 제안 — 모듈 docstring 참고).

    규칙(제안):
    - 승인과 게시를 분리한다. 승인(APPROVED)만으로 학부모에게 공개하지 않는다 —
      공개 여부는 활성(revoked_at is null) DocumentPublication 존재로 판단한다.
    - revoke_deadline은 실제 게시가 성공적으로 커밋된 시각(published_at)부터 24시간이다
      — 게시를 "요청한" 시각이 아니라 "완료된" 시각 기준.
    - 재게시하면 새 회차(round_number 증가)와 새 revoke_deadline이 생긴다. 이전 회차는
      그대로 두고 새 회차만 활성으로 취급한다.
    - 같은 (request_id, draft_id) 조합의 재전송은 새 회차를 만들지 않고 기존 회차를
      그대로 반환한다 — 이때 revoke_deadline을 다시 계산하거나 연장하지 않는다.

    학부모 열람 페이지의 letterId는 draft_id를 그대로 쓰고(재게시돼도 링크 불변),
    "현재 활성 회차"는 draft_id 기준 최신 행(revoked_at is null)으로 조회한다
    — 팀 합의 전 제안(letterId=draft_id 재사용안).
    """

    __tablename__ = "document_publications"
    __table_args__ = (
        # 한 request_id로 여러 draft_id를 한 번에 게시하므로(POST /letters/publish),
        # 멱등 판단은 draft_id별로 해야 한다 — request_id 단독 유니크는 두 번째
        # draft부터 저장이 막힌다.
        UniqueConstraint("publish_request_id", "draft_id", name="uq_publication_request_draft"),
        UniqueConstraint("draft_id", "round_number", name="uq_publication_draft_round"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), ForeignKey("draft_documents.id"), nullable=False)
    round_number = Column(Integer, nullable=False)
    # "같은 게시 요청의 재전송은 새 회차를 만들지 않는다" — draft_id와 묶어 멱등 키로 쓴다.
    publish_request_id = Column(String, nullable=False)
    # 게시 시점의 DraftDocument.version 스냅샷 — 이후 내용이 바뀌어도 "그때 무엇을
    # 게시했는지" 감사 가능하게 한다.
    published_version = Column(Integer, nullable=False)
    published_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    revoke_deadline = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    # 회수 자격 판단용. audit.AccessLog는 컴플라이언스 기록이고 조회 API가 없으므로
    # (audit/CLAUDE.md — router 없음), 회수 가능 여부는 이 필드로 직접 판단한다.
    # "목록 조회는 상세 열람으로 취급하지 않는다" — 이 필드는 상세 열람 API에서만 채운다.
    first_viewed_at = Column(DateTime(timezone=True), nullable=True)


class RevisionAction(StrEnum):
    """docs/테크스펙.md RevisionLog.action 값 (근거 ⑤ 승인·노출·로그)."""

    EDIT = "edit"
    APPROVE = "approve"
    REVOKE = "revoke"
    RESEND = "resend"


class EditMethod(StrEnum):
    """action=edit일 때만 채운다."""

    MANUAL = "manual"  # 교사가 직접 타이핑 (FR-17)
    PROMPT = "prompt"  # 교사가 요청문을 주고 AI가 재작성 (FR-18)


class RevisionLog(Base):
    """초안 생애주기 행위 이력. 수정뿐 아니라 승인·회수·재게시(resend)까지 이
    한 테이블에 기록한다 (테크스펙 ERD). action=edit 이외에는 edit_method·
    instruction_prompt·before_content/after_content가 비어 있을 수 있다.
    """

    __tablename__ = "revision_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), ForeignKey("draft_documents.id"), nullable=False)
    # auth.Teacher 참조 — auth/models.py가 아직 없어 FK 제약은 걸지 않는다.
    editor_id = Column(UUID(as_uuid=True), nullable=False)
    action = Column(String, nullable=False)
    edit_method = Column(String, nullable=True)
    # edit_method=prompt일 때 교사가 입력한 요청문 원문. NFR-11(지적사항 반영 확인)·
    # NFR-10(페르소나 갱신)의 원천 데이터.
    instruction_prompt = Column(Text, nullable=True)
    # 특정 문장만 수정한 경우 그 위치. 문서 전체 수정/승인/회수/재게시면 null.
    target_sentence_index = Column(Integer, nullable=True)
    # 문체다듬기/사실이다름 등. "사실이다름"은 사실 오류 지표 측정에 쓰인다.
    reason = Column(Text, nullable=True)
    before_content = Column(Text, nullable=True)
    after_content = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class UnclassifiedItem(Base):
    """서버 처리 중 교사 확인이 필요해진 항목 (테크스펙 ERD, "documents" 소유 확정 —
    docs/open-questions.md).

    ref_type/ref_id로 여러 종류를 가리키는 폴리모픽 참조다 (AccessLog/DeletionLog와
    같은 패턴). reason은 발화없음/검증실패/근거부족 등 **서버 도달 이후** 발생한
    사유만 기록한다 — 얼굴미매칭 등 업로드 전 판정 사유는 프론트(LocalPhoto)에서만
    관리되고 서버로 오지 않는다 (docs/open-questions.md 확인 완료 사항).
    """

    __tablename__ = "unclassified_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ref_type = Column(String, nullable=False)  # 예: "draft_document"
    ref_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    # auth.Teacher 참조 — 처리한 교사. 미해결이면 null.
    resolved_by = Column(UUID(as_uuid=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class Notice(Base):
    """반 단위 공지사항 (FR-11/12, should — 테크스펙 "⑥ 미정 기능 관련"). AI 생성
    문서와 무관한 교사 직접 작성 글이라 승인·게시 워크플로가 없다."""

    __tablename__ = "notices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # organization.Class 참조 — FK 제약 없음 (organization/models.py 미존재).
    class_id = Column(UUID(as_uuid=True), nullable=False)
    # auth.Teacher 참조 — FK 제약 없음 (사유 상동).
    teacher_id = Column(UUID(as_uuid=True), nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
