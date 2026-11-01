"""사진 1장씩 분석 — service._analyze_photos (파이프라인 5단계, NFR-09).

LLM은 실제로 부르지 않고 llm.call_vision 자리를 바꿔 끼웁니다(backend CLAUDE.md).
서명 URL도 S3를 부르지 않게 media 함수를 바꿔 끼웁니다.
"""

from datetime import UTC, datetime
from uuid import UUID

import httpx
import openai
import pytest

from domains.agents import service
from domains.media.service import AttributedChild, MediaEvidence, SignedMediaUrl
from tests.agents.fixtures.perception import (
    CHILD_A_ID,
    CHILD_B_ID,
    MEDIA_MEMO_ID,
    PHOTO_A_ID,
    PHOTO_B_ID,
    RECORD_DATE,
    answer,
    photo,
    response,
)
from tools.perception.types import PerceptionStatus

OK = response(answer("P1", ("블록을 높이 쌓고 있음", "individual")))
BROKEN = "JSON이 아닌 응답"


@pytest.fixture
def signed(monkeypatch: pytest.MonkeyPatch) -> None:
    def _signed(db, media_ids):
        return [
            SignedMediaUrl(
                media_id=media_id,
                type="photo",
                url=f"https://bucket.invalid/{media_id}?X-Amz-Signature=test",
                url_expires_at=datetime(2026, 9, 8, 4, 0, tzinfo=UTC),
            )
            for media_id in media_ids
        ]

    monkeypatch.setattr(service.media_service, "get_signed_urls", _signed)


def _replies(monkeypatch: pytest.MonkeyPatch, *answers: str | None) -> list[tuple[str, list]]:
    """call_vision이 차례로 answers를 돌려주게 하고, 받은 (지시문, URL 목록)을 모읍니다."""
    calls: list[tuple[str, list]] = []
    queue = list(answers)

    def _call(instructions: str, image_urls):
        calls.append((instructions, list(image_urls)))
        return queue.pop(0)

    monkeypatch.setattr(service, "call_vision", _call)
    return calls


def _analyze(*photos):
    return service._analyze_photos(
        None, list(photos), target_child_id=CHILD_A_ID, record_date=RECORD_DATE
    )


@pytest.mark.usefixtures("signed")
def test_사진마다_서명_URL로_한_번씩_불러_근거를_만든다(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _replies(monkeypatch, OK, OK)
    first, second = photo(), photo(media_id=PHOTO_B_ID)

    results = _analyze(first, second)

    assert [result.status for _, result in results] == [PerceptionStatus.OK] * 2
    assert [pair[0] for pair in results] == [first, second]
    assert [urls for _, urls in calls] == [
        [f"https://bucket.invalid/{UUID(PHOTO_A_ID)}?X-Amz-Signature=test"],
        [f"https://bucket.invalid/{UUID(PHOTO_B_ID)}?X-Amz-Signature=test"],
    ]
    # H-2: 지시문에는 media_id·child_id가 실리지 않습니다.
    for instructions, _ in calls:
        assert PHOTO_A_ID not in instructions
        assert CHILD_A_ID not in instructions


@pytest.mark.usefixtures("signed")
def test_응답_형식이_깨지면_그_사진만_한_번_다시_부른다(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _replies(monkeypatch, BROKEN, OK)

    [(_, result)] = _analyze(photo())

    assert len(calls) == service.PHOTO_RESPONSE_RETRIES + 1
    assert result.status == PerceptionStatus.OK


@pytest.mark.usefixtures("signed")
def test_다시_불러도_깨지면_빼지_않고_응답_오류_결과로_둔다(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _replies(monkeypatch, BROKEN, None)

    [(_, result)] = _analyze(photo())

    assert len(calls) == 2
    assert result.status == PerceptionStatus.RESPONSE_ERROR


@pytest.mark.usefixtures("signed")
def test_호출_예외는_사진_단위에서_잡지_않고_올린다(monkeypatch: pytest.MonkeyPatch) -> None:
    # 재시도 대상 예외는 Celery task 재시도가 맡습니다 (테크스펙 §오류 복구, #155).
    def _fail(instructions, image_urls):
        raise openai.APIConnectionError(request=httpx.Request("POST", "http://llm.invalid/v1"))

    monkeypatch.setattr(service, "call_vision", _fail)

    with pytest.raises(openai.APIConnectionError):
        _analyze(photo())


def test_근거_미디어의_사진만_저장된_귀속_그대로_분석_입력으로_바꾼다() -> None:
    doyun, friend = UUID(CHILD_A_ID), UUID(CHILD_B_ID)
    captured = datetime(2026, 9, 8, 3, 0, tzinfo=UTC)

    def evidence(media_id: str, media_type: str, links) -> MediaEvidence:
        return MediaEvidence(
            media_id=UUID(media_id),
            type=media_type,
            captured_at=captured,
            storage_url="s3://bucket/key",
            child_links=tuple(links),
        )

    photos = service._photo_inputs(
        [
            evidence(
                PHOTO_A_ID,
                "photo",
                [AttributedChild(doyun, "manual"), AttributedChild(friend, "face_recognition")],
            ),
            evidence(PHOTO_B_ID, "photo", []),  # 귀속이 없는 사진은 뺍니다
            evidence(MEDIA_MEMO_ID, "voice_memo", [AttributedChild(doyun, "manual")]),
        ]
    )

    assert [item.media_id for item in photos] == [PHOTO_A_ID]
    assert photos[0].child_ids == tuple(sorted([CHILD_A_ID, CHILD_B_ID]))
