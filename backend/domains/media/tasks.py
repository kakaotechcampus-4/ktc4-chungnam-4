from uuid import UUID

from celery import Task

from celery_app import celery_app
from domains.media import service


def _media_id(args: tuple, kwargs: dict) -> str:
    return kwargs["media_id"] if "media_id" in kwargs else args[0]


class _TranscribeTask(Task):
    """최종 실패를 MediaAsset에 남기는 훅만 둔다. 로직은 service에 있다."""

    def on_failure(self, exc, task_id, args, kwargs, einfo) -> None:
        service.mark_transcription_failed(_media_id(args, kwargs))


# 재시도는 조각 단위로 stt.py 안에서 한다 — 작업을 다시 돌리면 성공한 조각까지 다시 보낸다.
# 작업 전체 상한은 엘리스가 계속 느릴 때 worker 칸을 끝없이 붙잡지 않게 한다. 넘으면 failed.
# TODO(donggeon): 10분 음성 실측 뒤 상한 확정 (지금은 임시 600초)
@celery_app.task(base=_TranscribeTask, soft_time_limit=600, time_limit=630)
def transcribe_media(media_id: str) -> None:
    service.transcribe_media(media_id)


def enqueue_transcription(media_id: UUID | None) -> None:
    """영상·음성의 STT 작업을 큐에 넣는다. worker가 MediaAsset을 읽으므로 커밋한 뒤에 부른다.

    브로커 장애로 넣지 못하면 failed로 바꾼 뒤 예외를 다시 올린다. pending으로 두면
    화면이 STT를 영원히 기다린다.
    """
    if media_id is None:
        return
    try:
        transcribe_media.delay(media_id=str(media_id))
    except Exception:
        service.mark_transcription_failed(str(media_id))
        raise
