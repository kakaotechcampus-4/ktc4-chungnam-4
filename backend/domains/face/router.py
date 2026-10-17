"""face 라우터 (docs/api/media-face.md).

경로는 리소스 기준(/classes/{class_id}/face-embeddings, /children/{child_id}/face-embedding)이라
도메인 prefix를 두지 않습니다. 베이스 경로 `/api/v1`은 `main.py`가 붙입니다(#130 리뷰).
판정·조회는 전부 service.py가 하고, 이 파일은 요청을 넘기고 응답 모양으로 바꾸기만 합니다.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from core.database import get_db
from domains.auth.middleware import CurrentTeacher
from domains.face import service
from domains.face.schemas import (
    FaceEmbeddingItem,
    FaceEmbeddingListResponse,
    FaceEmbeddingRegisterRequest,
    FaceEmbeddingRegisterResponse,
)

router = APIRouter(tags=["face"])


@router.get("/classes/{class_id}/face-embeddings", response_model=FaceEmbeddingListResponse)
def list_class_face_embeddings(
    class_id: UUID,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> FaceEmbeddingListResponse:
    """온디바이스 분류를 시작할 때 반 동의 원아의 기준 임베딩을 내려줍니다 (FR-04, 파이프라인 0단계)."""
    cache = service.load_embedding_cache(
        db, class_id, teacher_id=teacher.teacher_id, center_id=teacher.center_id
    )
    # 열람 기록(AccessLog)이 커밋된 뒤에만 임베딩을 내보냅니다 (NFR-05, service docstring).
    db.commit()
    # 브라우저는 이번 배치 동안만 들고 있다가 버립니다. 디스크·프록시 캐시에 남기지 않습니다 (H-3).
    response.headers["Cache-Control"] = "no-store"
    return FaceEmbeddingListResponse(
        items=[
            FaceEmbeddingItem(
                child_id=item.child_id,
                embedding=item.embedding,
                model_version=item.model_version,
            )
            for item in cache
        ]
    )


@router.put("/children/{child_id}/face-embedding", response_model=FaceEmbeddingRegisterResponse)
def register_face_embedding(
    child_id: UUID,
    body: FaceEmbeddingRegisterRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> FaceEmbeddingRegisterResponse:
    """얼굴 정보 등록·갱신. 브라우저가 뽑은 벡터만 받아 암호화해 저장합니다 (FR-04, H-3)."""
    registered = service.register_child_embedding(
        db,
        child_id=child_id,
        center_id=teacher.center_id,
        vector=body.embedding,
        model_version=body.model_version,
    )
    db.commit()
    return FaceEmbeddingRegisterResponse(
        child_id=registered.child_id,
        model_version=registered.model_version,
        registered_at=registered.registered_at,
    )


@router.delete("/children/{child_id}/face-embedding", status_code=HTTPStatus.NO_CONTENT)
def delete_face_embedding(
    child_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> None:
    """얼굴 정보 삭제. 지울 것이 없어도 204입니다 (FR-22, H-4)."""
    service.delete_child_embedding(db, child_id=child_id, center_id=teacher.center_id)
    db.commit()
