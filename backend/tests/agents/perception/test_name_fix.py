"""STT 이름 바로잡기 응답 읽기와 적용 (파이프라인 1-C). 합성 이름만 쓴다."""

import pytest

from tools.perception.name_fix import (
    MAX_SOUND_DISTANCE,
    MIN_NAME_MARGIN,
    NameFix,
    apply_name_fixes,
    name_margin,
    parse_name_fix_response,
    sound_distance,
)

# 프롬프트에 넣은 명단, 원아마다 [호칭, 성명] (합성 이름)
CHILDREN = (("서아", "이서아"), ("로하", "한로하"), ("하은", "송하은"), ("하준", "김하준"))
# #274 조원 녹음의 가상 명단 일부. 서연·서윤처럼 소리가 비슷한 이름이 같이 있다
SIMILAR = (("서연", "김서연"), ("서윤", "박서윤"), ("유나", "송유나"))


def test_JSON만_온_응답에서_고칠_곳을_읽는다():
    content = '{"fixes": [{"line": 2, "from": "서화가", "to": "서아가"}]}'

    assert parse_name_fix_response(content, 3) == [
        NameFix(line=2, source="서화가", target="서아가")
    ]


def test_생각_과정_뒤에_붙은_JSON을_읽는다():
    # reasoning_effort=low에서 게이트웨이의 Claude가 이렇게 답하는 일이 잦았다 (11/05 실측)
    content = (
        '줄별로 확인했다.\n1. "서화가"는 명단의 서아가 맞다. {"이건": "예시"}\n\n'
        '{"fixes": [{"line": 1, "from": "서화가", "to": "서아가"}]}'
    )

    assert parse_name_fix_response(content, 1) == [NameFix(1, "서화가", "서아가")]


def test_코드_블록으로_감싼_JSON을_읽는다():
    assert parse_name_fix_response('```json\n{"fixes": []}\n```', 1) == []


@pytest.mark.parametrize(
    "content",
    [None, "", "  ", "고칠 곳이 없습니다", '["fixes"]', '{"fixes": "없음"}', '{"answer": []}'],
)
def test_형식이_깨지면_None을_돌려준다(content):
    assert parse_name_fix_response(content, 2) is None


def test_깨진_항목과_범위_밖_줄은_그_항목만_버린다():
    content = (
        '{"fixes": ['
        '{"line": 0, "from": "가", "to": "나"}, {"line": 3, "from": "가", "to": "나"}, '
        '{"line": "2", "from": "지오는", "to": "지우는", "reason": "소리가 비슷함"}, '
        '{"line": 1, "from": "", "to": "나"}, {"line": 1, "to": "나"}, "문자열"]}'
    )

    assert parse_name_fix_response(content, 2) == [NameFix(2, "지오는", "지우는")]


def test_소리가_가까운_수정만_그_줄에_적용한다():
    lines = ["안노아가 친구에게 장난감을 빌려주었어요.", "송시스러, 가자.", "블록 정리하자."]
    fixes = [
        NameFix(1, "안노아가", "한로하가"),  # 거리 3: 맞는 수정
        NameFix(2, "송시스러", "송하은"),  # 거리 5: 소음 속 헛말을 이름으로 바꿈
    ]

    # 소리 확인만 보려고 여유 확인은 끈다
    outcome = apply_name_fixes(lines, fixes, CHILDREN, min_margin=0)

    assert outcome.lines == [
        "한로하가 친구에게 장난감을 빌려주었어요.",
        "송시스러, 가자.",
        "블록 정리하자.",
    ]
    assert (outcome.applied, outcome.blocked_sound, outcome.blocked) == (1, 1, 1)


def test_고친_말에_명단_이름이_없으면_소리가_가까워도_막는다():
    # 프롬프트 규칙("이름이 아닌 낱말은 고치지 않는다")을 서버가 지킨다 (#270 리뷰)
    lines = ["블로그 높이 쌓았어요.", "사고 먹을 사람?"]
    fixes = [NameFix(1, "블로그", "블록"), NameFix(2, "사고", "사과")]

    outcome = apply_name_fixes(lines, fixes, CHILDREN)

    assert outcome.lines == lines
    assert (outcome.applied, outcome.blocked_not_name) == (0, 2)


def test_적힌_말이_그_줄에_없으면_적용하지도_세지도_않는다():
    outcome = apply_name_fixes(
        ["서화가 웃었다.", "하준아 가자."], [NameFix(2, "서화가", "서아가")], CHILDREN
    )

    assert outcome.lines == ["서화가 웃었다.", "하준아 가자."]
    assert (outcome.applied, outcome.blocked) == (0, 0)


def test_적힌_말이_그_줄에_두_번_있으면_자리를_몰라_건너뛴다():
    outcome = apply_name_fixes(["서화야 서화야"], [NameFix(1, "서화야", "서아야")], CHILDREN)

    assert outcome.lines == ["서화야 서화야"]
    assert (outcome.applied, outcome.skipped_repeated) == (0, 1)


def test_비슷한_다른_원아가_있으면_고치지_않는다():
    # #274 조원 녹음에서 나온 두 경우. "사연이도"는 서연(거리 1)과 서윤(거리 2) 사이라 애매하다
    lines = ["눈 감자. 사연이도 이불 덮고,", "송윤아 왔나요?"]
    fixes = [NameFix(1, "사연이도", "서연이도"), NameFix(2, "송윤아", "송유나")]

    outcome = apply_name_fixes(lines, fixes, SIMILAR)

    assert outcome.lines == ["눈 감자. 사연이도 이불 덮고,", "송유나 왔나요?"]
    assert (outcome.applied, outcome.blocked_ambiguous) == (1, 1)


def test_여유는_다른_원아_이름을_넣어_본_거리와의_차이다():
    assert name_margin("사연이도", "서연이도", SIMILAR) == 1  # 서윤이도: 거리 2 − 1
    assert name_margin("사연이도", "사과", SIMILAR) is None  # 명단 이름이 없다
    assert MIN_NAME_MARGIN == 2


def test_반에_다른_원아가_없으면_여유를_따지지_않는다():
    outcome = apply_name_fixes(
        ["서화야 가자."], [NameFix(1, "서화야", "서아야")], (("서아", "이서아"),)
    )

    assert outcome.lines == ["서아야 가자."]


def test_입력_목록은_바꾸지_않는다():
    lines = ["서화야"]

    apply_name_fixes(lines, [NameFix(1, "서화야", "서아야")], CHILDREN)

    assert lines == ["서화야"]


@pytest.mark.parametrize(
    "before, after, expected",
    [
        ("하주니가", "하준이가", 1),
        ("서화", "서아", 2),
        ("좋은 우라", "조은우가", 2),  # 띄어쓰기는 세지 않는다
        ("안노아가", "한로하가", 3),
        ("건두송", "건우야", 4),
        ("송시스러", "송하은", 5),
    ],
)
def test_띄어쓰기를_빼고_자모로_풀어_소리_거리를_잰다(before, after, expected):
    assert sound_distance(before, after) == expected


def test_기준_거리는_실험에서_정한_3이다():
    assert MAX_SOUND_DISTANCE == 3
