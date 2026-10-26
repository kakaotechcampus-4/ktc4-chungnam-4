"""face 도메인 요청·응답 스키마 (docs/api/media-face.md).

임베딩 벡터는 응답에만 실립니다. 이 스키마를 로그에 찍지 않습니다 (H-4).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FaceEmbeddingItem(BaseModel):
    """반 기준 임베딩 캐시의 한 원아."""

    child_id: UUID
    # 브라우저 모델이 뽑은 float 벡터(H-3: 사진이 아니라 벡터만 내보냄). HUMAN faceres는 1024개(#120).
    # 길이는 검사하지 않습니다 — 다른 모델의 벡터가 섞이는 것은 model_version 비교로 막습니다.
    embedding: list[float]
    model_version: str


class FaceEmbeddingListResponse(BaseModel):
    """`GET /classes/{class_id}/face-embeddings` 응답.

    반당 원아가 6명 남짓이라 나눠 보내지 않습니다. `next_cursor`는 공통 목록 모양을 맞추려고
    두는 자리이고 항상 null입니다.
    """

    items: list[FaceEmbeddingItem]
    next_cursor: str | None = None


class FaceEmbeddingRegisterRequest(BaseModel):
    """`PUT /children/{child_id}/face-embedding` 요청. 사진 원본은 받지 않습니다(H-3)."""

    # 길이는 검사하지 않습니다 — 모델마다 다르고(HUMAN faceres 1024, #120) model_version으로 구분합니다
    embedding: list[float] = Field(min_length=1)
    model_version: str = Field(min_length=1)


class FaceEmbeddingRegisterResponse(BaseModel):
    """등록 결과. 벡터는 돌려주지 않습니다."""

    child_id: UUID
    model_version: str
    registered_at: datetime
