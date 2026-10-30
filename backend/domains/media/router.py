"""media 라우터 (docs/api/media-face.md).

경로는 리소스 기준(/media/...)이라 도메인 prefix를 두지 않습니다. 베이스 경로 `/api/v1`은
`main.py`가 붙입니다. 판정·조회·S3는 전부 service.py가 하고, 이 파일은 요청을 넘기고
응답 모양으로 바꾸기만 합니다.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from core.database import get_db
from domains.auth.middleware import CurrentTeacher
from domains.media import service
from domains.media.schemas import (
    ChildLinkBody,
    MediaAssetResponse,
    MediaCompleteRequest,
    MediaUrlResponse,
    UploadUrlResponseItem,
    UploadUrlsRequest,
    UploadUrlsResponse,
)
from domains.media.tasks import enqueue_transcription

router = APIRouter(tags=["media"])

# 새로 확정하면 201, 같은 파일을 다시 보내 기존 것을 돌려주면 200
_STATUS_BY_CREATED = {True: HTTPStatus.CREATED, False: HTTPStatus.OK}


def _links(links: list) -> list[ChildLinkBody]:
    return [ChildLinkBody.model_validate(link, from_attributes=True) for link in links]


@router.post("/media/upload-urls", response_model=UploadUrlsResponse)
def request_upload_urls(
    body: UploadUrlsRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> UploadUrlsResponse:
    """파일마다 S3 업로드 URL을 발급합니다. 한 파일이 걸려도 나머지는 발급합니다 (FR-15)."""
    results = service.issue_upload_urls(
        db,
        class_id=body.class_id,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
        items=[item.to_item() for item in body.items],
    )
    # 발급 기록이 남아야 고아 객체를 추적할 수 있어 응답 전에 커밋합니다
    db.commit()
    return UploadUrlsResponse(
        items=[UploadUrlResponseItem.model_validate(r, from_attributes=True) for r in results]
    )


@router.post("/media", response_model=MediaAssetResponse, status_code=HTTPStatus.CREATED)
def complete_upload(
    body: MediaCompleteRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> MediaAssetResponse:
    """업로드 완료 통지. S3를 직접 재서 확정하고, 사진이면 귀속까지 저장합니다 (FR-15, FR-04)."""
    result = service.complete_upload(
        db,
        client_photo_id=body.client_photo_id,
        class_id=body.class_id,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
        media_type=body.type,
        captured_at=body.captured_at,
        model_version=body.model_version,
        attribution=body.to_attribution(),
    )
    # 이 응답이 ack입니다. FE는 이걸 받고 원본을 지우므로 커밋이 끝난 뒤에 돌려줍니다
    db.commit()
    enqueue_transcription(result.to_transcribe)
    response.status_code = _STATUS_BY_CREATED[result.created]
    asset = result.asset
    return MediaAssetResponse(
        media_id=asset.id,
        client_photo_id=asset.client_photo_id,
        class_id=asset.class_id,
        type=asset.type,
        captured_at=asset.captured_at,
        size_bytes=asset.size_bytes,
        llm_allowed=asset.llm_allowed,
        child_links=_links(result.child_links),
        attributed_at=asset.attributed_at,
    )


@router.get("/media/{media_id}", response_model=MediaUrlResponse)
def reissue_media_url(
    media_id: UUID,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> MediaUrlResponse:
    """만료된 근거 미디어의 서명 URL을 다시 줍니다. 교사만, 같은 어린이집 반의 미디어만 (FR-07)."""
    asset, signed = service.reissue_signed_url(
        db, media_id=media_id, teacher_id=teacher.teacher_id, center_id=teacher.center_id
    )
    # 열람 기록(AccessLog)이 커밋된 뒤에만 URL을 내보냅니다 (NFR-05)
    db.commit()
    # 서명 URL이 디스크·프록시 캐시에 남지 않게 합니다
    response.headers["Cache-Control"] = "no-store"
    return MediaUrlResponse(
        media_id=signed.media_id,
        type=signed.type,
        captured_at=asset.captured_at,
        url=signed.url,
        url_expires_at=signed.url_expires_at,
    )
