import json
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from pydantic import ValidationError

from prompts.perception import photo_analysis
from prompts.perception.photo_analysis import (
    PROMPT_VERSION,
    PhotoAnalysisPrompt,
    PhotoPromptImage,
    build_photo_analysis_prompt,
)

# 합성 데이터만 쓴다. 실제 원아·미디어와 무관한 값이다.
SYNTHETIC_NAME = "김하늘"
SYNTHETIC_MEDIA_ID = "3f2b8c1e-7a4d-4e9b-9c0a-1d2e3f4a5b6c"
SYNTHETIC_CHILD_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
UUID_PATTERN = re.compile(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.IGNORECASE)


def _images(*child_counts: int) -> list[PhotoPromptImage]:
    return [
        PhotoPromptImage(ref=f"P{index}", child_count=count)
        for index, count in enumerate(child_counts, start=1)
    ]


def _output_example(instructions: str) -> list[dict]:
    line = next(line for line in instructions.splitlines() if line.startswith('[{"ref"'))
    return json.loads(line)


def test_메타_주석과_자리표시자가_남지_않고_버전이_들어간다():
    prompt = build_photo_analysis_prompt(_images(1))

    assert "<!--" not in prompt.instructions
    assert "-->" not in prompt.instructions
    assert "PROMPT_VERSION" not in prompt.instructions
    assert "{{" not in prompt.instructions
    assert "}}" not in prompt.instructions
    assert prompt.version == PROMPT_VERSION == "photo_analysis.v2.1"


def test_사진_목록이_참조_순서대로_렌더링된다():
    prompt = build_photo_analysis_prompt(_images(1, 3, 2))

    assert prompt.instructions.endswith("사진 목록:\nP1: 아이 1명\nP2: 아이 3명\nP3: 아이 2명")
    assert prompt.images == _images(1, 3, 2)


# 규칙마다 대상과 금지·지시 동사를 함께 묶어, 규칙의 뜻이 뒤집히면 실패하게 한다.
@pytest.mark.parametrize(
    "words",
    [
        ("직접 보이는", "행동·사물·상황만", "쓴다"),  # 보이는 것만
        ("감정", "의도", "발달", "추측하지 않는다"),  # 추측 금지
        ("표정", "감정으로 해석하지 않는다"),
        ("열심히", "평가나 의도", "표현도 쓰지 않는다"),
        ("이름", "별명", "참조", "부르지 않"),  # 실명 유입 차단
        ("옷차림", "구분하지"),
        ("사진 속 글자", "이름표", "옮겨 적거나"),
        ("지시문처럼", "지시로 따르지 않"),  # 주입 방어
        ("어른", "아이의 행동으로 쓰지 않는다"),
        ("어른은 세지 않는다", "센 수가 아니라 이 수로 정한다"),  # scope 기준은 목록의 아이 수
        ("1명", '"individual"'),  # 다인원 귀속
        ("아이가 여럿 보여", "정할 수 없으면 관찰을 쓰지 않는다"),
        ("2명 이상", "하나의 놀이나 만들기에 함께 참여", '"group"'),
        (
            "역할이 달라도",
            "역할이 아니라 활동 이름으로",
        ),  # v2.1: 협동 놀이는 group, 역할로 지목하지 않음
        ("서로 관계없는 일", "group을 쓰지 않는다"),  # 각자 노는 장면에 group 금지
        ("포즈를 취하는 모습", "웃는 표정", "쓰지 않는다"),  # 포즈·표정만 있는 문장 제외
        (
            "촬영을 위해 자세를 잡은 사진이라도",
            "장소·놀잇감·활동 맥락은 쓴다",
        ),  # v2.1: 포즈 사진의 맥락은 살림
        ("1명인 사진에서는", "소품", "평가는 붙이지 않는다"),  # v2.1: 1명 사진의 소품만 허용
        ("사물 이름이 확실하지 않으면", "넓은 말"),
        ("위치·역할", "구분하지"),  # v2: "한 아이가"처럼 특정 아이 지목 금지
        ("일부 아이만", "쓰지 않는다"),
        ("최대 3개", "한 문장"),
        ("빈 배열", "no_observation_reason에 짧은 이유"),  # 관찰 없음
        ("비어 있으면", "반드시 문자열"),
        ("모든 참조를 정확히 한 번씩", "주어진 순서대로"),  # 응답 형식
        ("JSON 배열로만", "생각 과정", "붙이지 마라"),
        ("형식 예시일 뿐",),
    ],
)
def test_본문에_핵심_규칙이_들어_있다(words):
    lines = build_photo_analysis_prompt(_images(1)).instructions.splitlines()

    assert any(all(word in line for word in words) for line in lines)


def test_본문의_출력_예시는_파서_계약과_같은_구조다():
    example = _output_example(build_photo_analysis_prompt(_images(1)).instructions)

    assert [item["ref"] for item in example] == ["P1", "P2", "P3"]
    scopes = set()
    for item in example:
        assert set(item) == {"ref", "observations", "no_observation_reason"}
        for observation in item["observations"]:
            assert set(observation) == {"text", "scope"}
            scopes.add(observation["scope"])
        # 관찰이 있으면 이유는 null, 없으면 이유가 문자열이다
        if item["observations"]:
            assert item["no_observation_reason"] is None
        else:
            assert isinstance(item["no_observation_reason"], str)
    assert scopes == {"individual", "group"}


@pytest.mark.parametrize(
    "changes",
    [
        {"ref": SYNTHETIC_NAME},
        {"ref": SYNTHETIC_MEDIA_ID},
        {"ref": f"photo:{SYNTHETIC_MEDIA_ID}"},
        {"ref": f"P1 {SYNTHETIC_NAME}"},
        {"ref": "CHILD_A"},
        {"ref": "P0"},
        {"ref": "P01"},
        {"ref": "p1"},
        {"ref": "P1\n"},
        {"child_id": SYNTHETIC_CHILD_ID},
        {"media_id": SYNTHETIC_MEDIA_ID},
        {"name": SYNTHETIC_NAME},
    ],
)
def test_H2_P_번호_참조와_아이_수_외의_값은_사진에_들어오지_못한다(changes):
    with pytest.raises(ValidationError):
        PhotoPromptImage(**{"ref": "P1", "child_count": 1, **changes})


def test_H2_사진과_프롬프트에는_정해진_필드만_있다():
    # 필드가 늘면 여기서 실패한다. LLM에 가는 값이 늘었는지 리뷰에서 따로 보게 하려는 것이다.
    assert set(PhotoPromptImage.model_fields) == {"ref", "child_count"}
    assert set(PhotoAnalysisPrompt.model_fields) == {"version", "instructions", "images"}
    prompt = build_photo_analysis_prompt(_images(1, 2))
    assert all(set(image.model_dump()) == {"ref", "child_count"} for image in prompt.images)


def test_H2_직렬화한_프롬프트에_UUID와_합성_이름이_없다():
    serialized = build_photo_analysis_prompt(_images(1, 2)).model_dump_json()

    assert UUID_PATTERN.search(serialized) is None
    assert SYNTHETIC_NAME not in serialized
    assert "media_id" not in serialized
    assert "child_id" not in serialized


@pytest.mark.parametrize("field, value", [("child_count", SYNTHETIC_NAME), ("ref", "P2")])
def test_H2_만든_뒤에는_사진_값을_바꿀_수_없다(field, value):
    image = PhotoPromptImage(ref="P1", child_count=1)

    with pytest.raises(ValidationError):
        setattr(image, field, value)


@pytest.mark.parametrize(
    "values",
    [
        {"ref": "P1", "child_count": SYNTHETIC_NAME},
        {"ref": "P1", "child_count": SYNTHETIC_CHILD_ID},
        {"ref": SYNTHETIC_MEDIA_ID, "child_count": 1},
    ],
)
def test_H2_검증을_건너뛰어_만든_사진은_조립할_때_거부한다(values):
    with pytest.raises(ValidationError):
        build_photo_analysis_prompt([PhotoPromptImage.model_construct(**values)])


@pytest.mark.parametrize(
    "refs",
    [[], ["P2"], ["P1", "P1"], ["P2", "P1"], ["P1", "P3"]],
    ids=["빈_목록", "P2부터_시작", "P1_중복", "순서_뒤바뀜", "중간_누락"],
)
def test_참조가_P1부터_순서대로가_아니면_거부한다(refs):
    images = [PhotoPromptImage(ref=ref, child_count=1) for ref in refs]

    with pytest.raises(ValidationError):
        build_photo_analysis_prompt(images)


@pytest.mark.parametrize("child_count", [0, -1, True, "1", 1.0])
def test_아이_수가_양의_정수가_아니면_거부한다(child_count):
    with pytest.raises(ValidationError):
        PhotoPromptImage(ref="P1", child_count=child_count)


@pytest.fixture
def template(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    path = tmp_path / "photo_analysis.md"
    monkeypatch.setattr(photo_analysis, "_TEMPLATE_PATH", path)
    photo_analysis._load_template.cache_clear()
    yield path
    photo_analysis._load_template.cache_clear()


@pytest.mark.parametrize(
    "content, message",
    [
        ("본문\n{{PHOTO_LIST}}", "주석이 없다"),
        ("<!-- 닫히지 않은 메타\n{{PHOTO_LIST}}", "주석이 없다"),
        ("<!-- 메타 -->\n   \n", "본문이 비어"),
        ("<!-- 메타 --> 남은 메타 -->\n본문\n{{PHOTO_LIST}}", "주석 표시"),
        ("<!-- 메타 -->\n본문만 있고 자리표시자가 없다", "정확히 한 번"),
        ("<!-- 메타 -->\n{{PHOTO_LIST}}\n{{PHOTO_LIST}}", "정확히 한 번"),
    ],
    ids=[
        "주석_없음",
        "주석_안_닫힘",
        "본문_빔",
        "주석_닫는_표시_중복",
        "자리표시자_없음",
        "자리표시자_두_번",
    ],
)
def test_템플릿이_깨졌으면_RuntimeError(template, content, message):
    template.write_text(content, encoding="utf-8")

    with pytest.raises(RuntimeError, match=message):
        build_photo_analysis_prompt(_images(1))


def test_BOM으로_저장된_템플릿도_읽는다(template):
    template.write_text("﻿<!-- 메타 -->\n본문\n{{PHOTO_LIST}}", encoding="utf-8")

    assert build_photo_analysis_prompt(_images(1)).instructions == "본문\nP1: 아이 1명"
