"""사진 분석 LLM 응답을 근거(EvidenceItem)로 바꾼다 (NFR-09, FR-27의 입력).

파이프라인 5단계 안의 '사진 맥락 추출' 결과를 받는다 (docs/테크스펙.md 처리 파이프라인).
프롬프트는 prompts/perception/photo_analysis가 만들고 LLM 호출은 domains/agents가 맡는다.

- assign_photo_refs가 사진에 P1..Pn 참조를 붙이고, parse_photo_analysis가 그 참조로 응답을
  실제 media_id에 잇는다. LLM에는 참조만 가고 서버 ID는 가지 않도록 대응은 서버 안에만 둔다.
- 응답이 형식을 어기면 부분 결과 없이 RESPONSE_ERROR를 돌려준다. 재시도는 service가 판단한다.
- 출력은 서버 내부용 근거다. 관찰 문장에 이름이 들어가지 않게 프롬프트가 막지만, 비식별화
  단계를 거치기 전 데이터로 취급한다 (H-2).
- 순수 함수다. 응답 원문은 결과·예외 메시지 어디에도 남기지 않고 로그도 남기지 않는다 (H-4).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Literal, Self

from pydantic import ConfigDict, Field, TypeAdapter, model_validator

from tools.contracts import AssignmentStatus, ContractModel, EvidenceItem, NonEmpty, SourceType
from tools.perception.transcript import kst_date
from tools.perception.types import (
    Dropped,
    DropReason,
    PerceptionResult,
    PerceptionStatus,
    PhotoInput,
)

_MAX_OBSERVATIONS = 3  # prompts/perception/photo_analysis.md 기록 규칙 8

# 응답 전체를 감싼 코드 블록 표시 한 겹. 프롬프트가 금지하지만 GLM이 어기면 재시도 비용이 들어
# 이것만 봐준다. 그 밖의 텍스트가 섞이면 JSON 파싱에서 실패한다.
_CODE_FENCE = re.compile(r"```(?:json)?\s*(?P<body>.*?)\s*```", re.DOTALL)

_Scope = Literal["individual", "group"]


class _Observation(ContractModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    text: NonEmpty
    scope: _Scope


class _PhotoAnswer(ContractModel):
    """응답 원소 하나. 형식은 prompts/perception/photo_analysis.md 머리 주석이 원본이다."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    ref: str
    # 4개 이상도 잘라 쓰지 않고 거부한다 — 프롬프트 계약 위반을 숨기지 않는다.
    observations: list[_Observation] = Field(max_length=_MAX_OBSERVATIONS)
    no_observation_reason: NonEmpty | None

    @model_validator(mode="after")
    def reason_only_without_observations(self) -> Self:
        if bool(self.observations) == (self.no_observation_reason is not None):
            raise ValueError("no_observation_reason must be set only when observations is empty")
        return self


_ANSWERS = TypeAdapter(list[_PhotoAnswer])


def assign_photo_refs(photos: Sequence[PhotoInput]) -> dict[str, PhotoInput]:
    """(촬영 시각, media_id) 순으로 P1..Pn을 붙인다. 입력 순서와 관계없이 같은 참조가 나온다."""
    if len({photo.media_id for photo in photos}) != len(photos):
        raise ValueError("duplicate media_id")  # ID도 메시지에 싣지 않는다
    ordered = sorted(photos, key=lambda photo: (photo.captured_at, photo.media_id))
    return {f"P{index}": photo for index, photo in enumerate(ordered, start=1)}


def parse_photo_analysis(
    raw: str | None,
    *,
    photos_by_ref: Mapping[str, PhotoInput],
    target_child_id: str,
    record_date: date,
) -> PerceptionResult:
    """사진 분석 응답을 대상 원아·기록 날짜의 근거로 바꾸고, 쓸 수 없는 관찰은 사유와 함께 버린다.

    photos_by_ref의 키는 정확히 P1..Pn이어야 하고 target_child_id는 앞뒤 공백을 지운 뒤 비면
    안 된다. 어기면 호출 오류로 ValueError를 낸다. 응답이 형식을 어기거나 본문이 없으면(None)
    예외 대신 RESPONSE_ERROR를 돌려준다.

    응답에 일부 참조가 빠지면 그 사진만 PHOTO_NOT_ANSWERED로 버리고 나머지 답은 쓴다. 빈
    배열처럼 아무 사진도 답하지 않은 응답은 실패로 보고 RESPONSE_ERROR를 돌려준다.
    """
    refs = [f"P{index}" for index in range(1, len(photos_by_ref) + 1)]
    if not refs or set(photos_by_ref) != set(refs):
        raise ValueError("photos_by_ref keys must be P1..Pn")
    if len({photo.media_id for photo in photos_by_ref.values()}) != len(refs):
        raise ValueError("duplicate media_id")  # 같은 evidence_id가 두 번 생기지 않게 한다
    target = target_child_id.strip()
    if not target:
        raise ValueError("target_child_id must not be empty")

    answers = _parse_answers(raw, refs=refs)
    if answers is None:
        return PerceptionResult(status=PerceptionStatus.RESPONSE_ERROR, items=[], dropped=[])
    items: list[EvidenceItem] = []
    dropped: list[Dropped] = []
    for ref in refs:
        photo = photos_by_ref[ref]
        outcomes = _photo_outcomes(
            photo, answers.get(ref), target_child_id=target, record_date=record_date
        )
        for outcome in outcomes:
            if isinstance(outcome, EvidenceItem):
                items.append(outcome)
            else:
                dropped.append(Dropped(source_id=photo.media_id, reason=outcome))
    status = PerceptionStatus.OK if items else PerceptionStatus.EMPTY
    return PerceptionResult(status=status, items=items, dropped=dropped)


def _parse_answers(raw: str | None, *, refs: Sequence[str]) -> dict[str, _PhotoAnswer] | None:
    """응답을 참조별 답으로 바꾼다. 형식을 어기면 None.

    JSON·스키마 오류는 재시도 대상이라 예외를 올리지 않고 None으로 알린다. 오류 내용에 응답
    원문이 담기므로 어디에도 남기지 않고 버린다 (H-4).
    """
    if raw is None:
        return None  # OpenAI 호환 응답의 message.content는 None일 수 있다
    body = raw.strip()
    fenced = _CODE_FENCE.fullmatch(body)
    if fenced is not None:
        body = fenced["body"]
    try:
        answers = _ANSWERS.validate_python(json.loads(body, object_pairs_hook=_unique_keys))
    except (ValueError, RecursionError):  # JSONDecodeError·ValidationError는 ValueError다
        return None
    if not answers:
        return None  # 사진을 보냈는데 아무것도 답하지 않은 응답은 실패로 본다
    by_ref = {answer.ref: answer for answer in answers}
    if len(by_ref) != len(answers) or not by_ref.keys() <= set(refs):
        return None  # 중복 참조·모르는 참조는 어느 사진의 답인지 믿을 수 없다
    return by_ref


def _unique_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """한 객체에 같은 키가 두 번 오면 거부한다. json.loads는 조용히 마지막 값을 쓴다."""
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise ValueError("duplicate key")  # 중복 참조와 같이 어느 값이 답인지 믿을 수 없다
    return obj


def _photo_outcomes(
    photo: PhotoInput, answer: _PhotoAnswer | None, *, target_child_id: str, record_date: date
) -> list[EvidenceItem | DropReason]:
    """사진 한 장의 관찰을 근거로 바꾼다. 사진째 못 쓰면 사유 하나만(위에서부터 먼저 걸린 것)."""
    if answer is None:
        return [DropReason.PHOTO_NOT_ANSWERED]
    if target_child_id not in photo.child_ids:
        return [DropReason.NOT_TARGET_CHILD]
    if kst_date(photo.captured_at) != record_date:
        return [DropReason.DATE_MISMATCH]
    if not answer.observations:
        return [DropReason.NO_VISIBLE_OBSERVATION]

    child_ids = list(photo.child_ids)
    assignment_status = _assignment_status(photo)
    outcomes: list[EvidenceItem | DropReason] = []
    # n은 응답 속 관찰 위치다. 버린 관찰도 번호를 차지해 ID가 응답 위치를 가리키게 한다.
    for n, observation in enumerate(answer.observations, start=1):
        if not _scope_matches(len(child_ids), observation.scope):
            # 다인원 사진에서 행동 주체가 불분명하면 특정 원아에게 귀속하지 않는다 (테크스펙 5단계)
            outcomes.append(DropReason.AMBIGUOUS_ACTOR)
            continue
        outcomes.append(
            EvidenceItem(
                evidence_id=f"photo:{photo.media_id}:{n}",
                source_type=SourceType.PHOTO_OBSERVATION,
                child_ids=child_ids,  # group이면 귀속 원아 전원의 공동 근거
                observed_date=record_date,
                text=observation.text,
                media_id=photo.media_id,
                assignment_status=assignment_status,
            )
        )
    return outcomes


def _scope_matches(child_count: int, scope: _Scope) -> bool:
    """아이 1명 사진은 individual, 2명 이상은 group만 맞다 (프롬프트 기록 규칙 6·7)."""
    return scope == ("individual" if child_count == 1 else "group")


def _assignment_status(photo: PhotoInput) -> AssignmentStatus:
    """서버에 온 귀속은 모두 교사 확인 체크를 거쳤지만, 자동 인식이 섞였다는 정보는 남긴다."""
    # TODO(송유진): face_recognition 귀속을 auto_linked로 볼지 미확정. 지금 검증(target.py)은
    #   needs_confirmation만 따로 봐서 이 값이 검증 결과를 바꾸지 않는다.
    if any(link.method == "face_recognition" for link in photo.links):
        return AssignmentStatus.AUTO_LINKED
    return AssignmentStatus.TEACHER_CONFIRMED
