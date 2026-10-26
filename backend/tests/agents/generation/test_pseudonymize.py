from datetime import date

import pytest

from tools.contracts import AssignmentStatus, EvidenceItem, SourceType
from tools.generation.pseudonymize import pseudonymize_evidence, restore_names

RECORD_DATE = date(2026, 9, 8)
# 실제 원아가 아닌 합성 이름이다 (루트 CLAUDE.md §Git: 실제 원아 정보 금지).
NAMES = {"child-1": ["가나다", "나다"], "child-2": ["라마바", "마바"]}


def _speech(evidence_id: str, text: str, child_ids: list[str]) -> EvidenceItem:
    return EvidenceItem(
        evidence_id=evidence_id,
        source_type=SourceType.VIDEO_SPEECH,
        child_ids=child_ids,
        observed_date=RECORD_DATE,
        text=text,
        media_id="media-1",
        start_ms=1000,
        end_ms=2000,
        assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
    )


def test_본문의_성명과_이름을_토큰으로_바꾸고_서버_ID를_싣지_않는다():
    evidence = {
        "ev-1": _speech("ev-1", "가나다야, 마바랑 같이 정리하자", ["child-1", "child-2"]),
        "ev-2": _speech("ev-2", "나다가 탑을 쌓았어요", ["child-1"]),
    }

    result = pseudonymize_evidence(evidence, target_child_id="child-1", names_by_child_id=NAMES)

    texts = [item.text for item in result.llm_items]
    assert texts == ["CHILD_A야, CHILD_B랑 같이 정리하자", "CHILD_A가 탑을 쌓았어요"]
    serialized = repr(result.llm_items)
    for forbidden in ("가나다", "나다", "마바", "child-1", "ev-1", "media-1"):
        assert forbidden not in serialized
    assert [item.ref for item in result.llm_items] == ["E1", "E2"]
    assert result.llm_items[0].shared_with_others is True


def test_참조를_서버_ID로_되돌릴_대응표와_실명을_지운_서버용_사본을_준다():
    evidence = {"ev-1": _speech("ev-1", "나다가 탑을 쌓았어요", ["child-1"])}

    result = pseudonymize_evidence(evidence, target_child_id="child-1", names_by_child_id=NAMES)

    assert result.evidence_id_by_ref == {"E1": "ev-1"}
    masked = result.evidence_by_id["ev-1"]
    assert masked.text == "CHILD_A가 탑을 쌓았어요"
    assert masked.media_id == "media-1"
    assert evidence["ev-1"].text == "나다가 탑을 쌓았어요"


def test_이름_목록이_없는_원아가_있으면_보내지_않는다():
    evidence = {"ev-1": _speech("ev-1", "같이 놀았어요", ["child-1", "child-3"])}

    with pytest.raises(ValueError):
        pseudonymize_evidence(evidence, target_child_id="child-1", names_by_child_id=NAMES)


def test_같은_입력이면_토큰이_항상_같다():
    evidence = {"ev-1": _speech("ev-1", "마바와 놀았어요", ["child-2", "child-1"])}

    first = pseudonymize_evidence(evidence, target_child_id="child-1", names_by_child_id=NAMES)
    second = pseudonymize_evidence(evidence, target_child_id="child-1", names_by_child_id=NAMES)

    assert first == second


def test_근거에_귀속되지_않은_같은_반_원아_이름도_토큰으로_바꾼다():
    # child-2는 근거의 child_ids에 없지만 발화에서 불린다 (#137 리뷰).
    evidence = {"ev-1": _speech("ev-1", "마바야 나다랑 같이 탑 쌓자", ["child-1"])}

    result = pseudonymize_evidence(evidence, target_child_id="child-1", names_by_child_id=NAMES)

    assert result.llm_items[0].text == "CHILD_B야 CHILD_A랑 같이 탑 쌓자"
    assert result.child_id_by_token == {"CHILD_A": "child-1", "CHILD_B": "child-2"}


def test_반_원아가_26명을_넘어도_토큰이_겹치지_않는다():
    names = {f"child-{index:02d}": [f"이름{index:02d}"] for index in range(30)}
    evidence = {"ev-1": _speech("ev-1", "같이 놀았어요", ["child-00"])}

    result = pseudonymize_evidence(evidence, target_child_id="child-00", names_by_child_id=names)

    assert len(set(result.child_id_by_token)) == 30


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("CHILD_A는 CHILD_B랑 놀았어요", "민준은 서아랑 놀았어요"),
        ("CHILD_A가 웃었어요.", "민준이 웃었어요."),
        ("CHILD_B가 CHILD_A를 도왔어요", "서아가 민준을 도왔어요"),
        ("CHILD_A와 CHILD_B", "민준과 서아"),
        ("CHILD_A이에요", "민준이에요"),
        ("CHILD_Z는 지어낸 토큰", "CHILD_Z는 지어낸 토큰"),
    ],
)
def test_토큰을_호칭으로_되돌리며_조사를_받침에_맞춘다(text, expected):
    assert restore_names(text, {"CHILD_A": "민준", "CHILD_B": "서아"}) == expected


@pytest.mark.parametrize("names", [[], ["", "  "]], ids=["빈_목록", "공백만"])
def test_이름이_비어_있는_원아가_근거에_있으면_보내지_않는다(names):
    evidence = {"ev-1": _speech("ev-1", "마바랑 놀았어요", ["child-1", "child-2"])}

    with pytest.raises(ValueError):
        pseudonymize_evidence(
            evidence,
            target_child_id="child-1",
            names_by_child_id={"child-1": ["나다"], "child-2": names},
        )


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("CHILD_A로 갔어요", "하늘로 갔어요"),
        ("CHILD_C으로 갔어요", "민준으로 갔어요"),
        ("CHILD_B이에요", "가나예요"),
        ("CHILD_C이에요", "민준이에요"),
    ],
)
def test_ㄹ_받침과_서술격_조사도_맞춘다(text, expected):
    names = {"CHILD_A": "하늘", "CHILD_B": "가나", "CHILD_C": "민준"}

    assert restore_names(text, names) == expected
