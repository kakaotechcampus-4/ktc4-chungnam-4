import logging
from uuid import UUID

from celery import Task
from kombu.exceptions import OperationalError

from celery_app import celery_app
from domains.media import service

logger = logging.getLogger(__name__)


def _media_id(args: tuple, kwargs: dict) -> str:
    return kwargs["media_id"] if "media_id" in kwargs else args[0]


class _TranscribeTask(Task):
    """최종 실패를 MediaAsset에 남기는 훅만 둔다. 로직은 service에 있다."""

    def on_failure(
        self, exc: BaseException, task_id: str, args: tuple, kwargs: dict, einfo: object
    ) -> None:
        service.mark_transcription_failed(_media_id(args, kwargs))


# 재시도는 조각 단위로 stt.py 안에서 한다 — 작업을 다시 돌리면 성공한 조각까지 다시 보낸다.
# 작업 전체 상한은 엘리스가 계속 느릴 때 worker 칸을 끝없이 붙잡지 않게 한다. 넘으면 failed.
# TODO(donggeon): 10분 음성 실측 뒤 상한 확정 (지금은 임시 600초)
@celery_app.task(base=_TranscribeTask, soft_time_limit=600, time_limit=630)
def transcribe_media(media_id: str) -> None:
    service.transcribe_media(media_id)


def enqueue_transcription(media_id: UUID | None) -> None:
    """영상·음성의 STT 작업을 큐에 넣는다. worker가 MediaAsset을 읽으므로 커밋한 뒤에 부른다.

    넣기 재시도는 Celery 기본값(3번, 0→0.2→0.4초 간격)이 교사 몰래 한다. 그래도 못 넣으면
    failed로 바꾸고 예외를 올리지 않는다(#219 리뷰). 업로드는 이미 커밋돼 확정됐으므로 완료
    통지는 성공으로 답하고, STT 실패는 transcript_status로 화면에 알린다. 500으로 답하면 교사는
    업로드 실패로 보고 다시 올리지만, 이미 등록된 파일이라 STT가 다시 시작되지 않는다.
    pending으로 두면 화면이 STT를 영원히 기다린다.
    """
    if media_id is None:
        return
    try:
        transcribe_media.delay(media_id=str(media_id))
    except OperationalError as error:  # 재시도를 다 쓴 브로커 연결 실패. Celery가 이걸로 감싼다
        logger.warning("stt enqueue failed: media_id=%s error=%s", media_id, type(error).__name__)
        service.mark_transcription_failed(str(media_id))
