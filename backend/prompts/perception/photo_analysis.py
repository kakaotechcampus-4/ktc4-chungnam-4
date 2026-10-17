"""사진 맥락 추출 프롬프트 조립.

파이프라인 5단계(에이전트1 근거 수집)의 세부 처리로, 사진에서 보이는 행동·사물·상황만
뽑게 하는 프롬프트를 만든다 (docs/테크스펙.md 처리 파이프라인 5단계, NFR-09).
본문은 같은 폴더의 photo_analysis.md에 두고, 이 모듈은 본문을 읽어 사진 목록을 채운다.

실제 LLM 호출은 domains/agents/llm.py가 맡는다. 이 모듈은 SDK 메시지 형식과 이미지
바이트를 모른다 — 호출하는 쪽이 images 순서대로 이미지를 붙인다.

H-2: LLM에는 P1..Pn 임시 참조와 사진별 아이 수만 간다. PhotoPromptImage에는 media_id·
child_id·이름이 들어갈 필드가 없고(extra 금지), ref는 P<번호> 형식만 받으므로 다른
식별자가 참조로 섞여 들어올 수 없다. 조립할 때 사진 값을 다시 검증하므로 만든 뒤
바꾼 값도 실리지 않는다. 참조와 실제 media_id의 대응은 호출하는 쪽이 서버 안에만 둔다.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from functools import cache
from pathlib import Path
from typing import Self

from pydantic import ConfigDict, Field, model_validator

from tools.contracts import ContractModel, NonEmpty
from tools.perception.photo import assign_photo_refs
from tools.perception.types import PhotoInput

PROMPT_VERSION = "photo_analysis.v2.1"

_TEMPLATE_PATH = Path(__file__).with_name("photo_analysis.md")
_PHOTO_LIST_SLOT = "{{PHOTO_LIST}}"
# 맨 앞 메타데이터 주석(입력 변수·기대 출력 형식). 사람이 읽는 용도라 LLM에는 보내지 않는다.
_META_COMMENT = re.compile(r"\A\s*<!--.*?-->\s*", re.DOTALL)


class PhotoPromptImage(ContractModel):
    """프롬프트에 붙는 사진 한 장. 귀속된 원아 수만 담고 이름·토큰·ID는 담지 않는다."""

    # 만든 뒤 값을 바꾸거나 model_construct로 검증을 건너뛴 값이 사진 목록에 실리지 않게 한다.
    model_config = ConfigDict(frozen=True, revalidate_instances="always")

    ref: str = Field(pattern=r"^P[1-9][0-9]*$")
    child_count: int = Field(ge=1, strict=True)


class PhotoAnalysisPrompt(ContractModel):
    """조립된 프롬프트. 호출하는 쪽은 images 순서대로 이미지를 붙인다."""

    version: NonEmpty
    instructions: NonEmpty
    images: list[PhotoPromptImage]

    @model_validator(mode="after")
    def refs_in_order(self) -> Self:
        if not self.images:
            raise ValueError("images must not be empty")
        expected = [f"P{index}" for index in range(1, len(self.images) + 1)]
        if [image.ref for image in self.images] != expected:
            raise ValueError("image refs must be P1..Pn in order")
        return self


@cache
def _load_template() -> str:
    """메타데이터 주석을 뗀 본문을 돌려준다. 템플릿이 깨졌으면 프로그래밍 오류로 본다."""
    raw = _TEMPLATE_PATH.read_text(encoding="utf-8-sig")
    comment = _META_COMMENT.match(raw)
    if comment is None:
        raise RuntimeError(f"{_TEMPLATE_PATH.name}: 맨 앞 메타데이터 주석이 없다")
    body = raw[comment.end() :].strip()
    if not body:
        raise RuntimeError(f"{_TEMPLATE_PATH.name}: 주석을 뗀 본문이 비어 있다")
    if "<!--" in body or "-->" in body:
        # 메타데이터 안에 닫는 표시가 섞이면 나머지 메타데이터가 본문으로 새어 LLM에 간다.
        raise RuntimeError(f"{_TEMPLATE_PATH.name}: 본문에 주석 표시가 남아 있다")
    if body.count(_PHOTO_LIST_SLOT) != 1:
        raise RuntimeError(f"{_TEMPLATE_PATH.name}: {_PHOTO_LIST_SLOT}가 정확히 한 번 있어야 한다")
    return body


def build_photo_analysis_prompt(images: Sequence[PhotoPromptImage]) -> PhotoAnalysisPrompt:
    """사진 목록을 채운 프롬프트를 만든다. 참조 순서 검증은 PhotoAnalysisPrompt가 한다."""
    checked = [PhotoPromptImage.model_validate(image) for image in images]
    photo_list = "\n".join(f"{image.ref}: 아이 {image.child_count}명" for image in checked)
    # 본문의 JSON 예시에 중괄호가 있어 str.format 대신 자리표시자만 바꾼다.
    instructions = _load_template().replace(_PHOTO_LIST_SLOT, photo_list)
    return PhotoAnalysisPrompt(version=PROMPT_VERSION, instructions=instructions, images=checked)


def photo_prompt_images(photos_by_ref: Mapping[str, PhotoInput]) -> list[PhotoPromptImage]:
    """assign_photo_refs 결과를 프롬프트 사진 목록으로 바꾼다.

    참조와 아이 수만 옮기고 media_id·child_id는 옮기지 않는다 (H-2). 아이 수는 파서가 scope를
    판정할 때 쓰는 것과 같은 PhotoInput.child_ids의 길이다. 참조 순서는 조립할 때 검증한다.
    """
    return [
        PhotoPromptImage(ref=ref, child_count=len(photo.child_ids))
        for ref, photo in photos_by_ref.items()
    ]


def build_single_photo_prompt(photo: PhotoInput) -> PhotoAnalysisPrompt:
    """사진 한 장을 분석하는 프롬프트를 만든다 (사진은 1장씩 호출한다).

    대상 원아와 무관하게 사진과 아이 수만으로 정해진다. service는 이 프롬프트로 받은 응답을
    같은 photo와 함께 parse_single_photo_analysis에 넘긴다.
    """
    return build_photo_analysis_prompt(photo_prompt_images(assign_photo_refs([photo])))
