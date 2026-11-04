"""네이티브 도구의 허용 목록과 작성 지침. 외부 호출·DB 접근은 service가 담당한다."""

import json
from typing import Literal

from tools.contracts import ContractModel

SECTIONS = ("신체운동·건강", "의사소통", "사회관계", "예술경험", "자연탐구", "종합의견")
COLLECTOR_TOOLS = ("activity_plan", "previous_records", "child_roster")
PARENT_TOOLS = ("emotional_vocabulary", "developmental_wording")
OBSERVATION_TOOLS = ("domain_style", "developmental_guideline")
TOOL_DESCRIPTIONS = {
    "activity_plan": "현재 반·활동 날짜의 계획을 조회한다. 계획은 관찰 사실이 아니다.",
    "previous_records": "현재 원아의 이전 게시 기록을 조회한다. 과거 일을 오늘 한 일로 쓰지 않는다.",
    "child_roster": "현재 반의 비식별 원아 토큰을 확인한다. 귀속을 변경하지 않는다.",
    "emotional_vocabulary": "관찰된 표현을 서술할 어휘를 조회한다. 내면 감정을 추측하지 않는다.",
    "developmental_wording": "현재 연령대에 맞는 알림장 작성 지침을 조회한다.",
    "domain_style": "관찰일지의 영역별 서술 방식을 조회한다.",
    "developmental_guideline": "관찰일지의 관찰·발달 서술 주의사항을 조회한다.",
}


class ToolArguments(ContractModel):
    # 사용자·원아·반·날짜·주소를 모델이 지정할 수 없다. 조회 범위는 인증된 Job에 고정한다.
    focus: Literal["general", "communication", "play", "expression"] = "general"


def tool_definitions(names: tuple[str, ...]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": TOOL_DESCRIPTIONS[name],
                "parameters": ToolArguments.model_json_schema(),
            },
        }
        for name in names
    ]


def writing_guidance(name: str, *, age_band: str, focus: str) -> str:
    """행동 서술용 기본 자료. 의료적 발달 평가나 공식 교육과정 인용으로 표현하지 않는다."""
    common = "관찰 근거에 있는 행동만 서술한다. 발달 수준·진단·의도·내면 감정은 추정하지 않는다."
    guides = {
        "domain_style": {
            "sections": list(SECTIONS),
            "style": "관찰 행동을 해당 영역에 배치하고 '~하였다' 문체로 쓴다. 근거 없는 영역은 비워 둔다.",
            "domains": {
                "신체운동·건강": "움직임·도구 사용·위생 행동",
                "의사소통": "실제 발화·듣기·표현 행동",
                "사회관계": "관찰된 또래 상호작용",
                "예술경험": "관찰된 음악·미술·표현 활동",
                "자연탐구": "관찰된 탐색·비교·분류 활동",
                "종합의견": "앞 영역의 근거 있는 행동만 종합",
            },
        },
        "developmental_guideline": {
            "rule": common,
            "age_guidance": "영아는 감각 탐색·몸짓 등 실제 반응을, 유아는 설명·놀이 과정을 근거에 있는 만큼 기록한다. 연령만으로 능력을 단정하지 않는다.",
            "avoid": ["또래보다 우수하다", "발달이 늦다", "사회성이 부족하다"],
        },
        "emotional_vocabulary": {
            "expression": ["웃음을 보였어요", "다시 해 보았어요", "친구에게 말을 건넸어요"],
            "condition": "그 행동이 근거에 있을 때만 사용한다. 웃음만으로 행복·성취감을 단정하지 않는다.",
        },
        "developmental_wording": {
            "templates": ["CHILD_A는 {관찰된 활동}을 하며 {관찰된 행동}을 보여 주었어요."],
            "rule": common + " 따뜻한 존댓말을 쓰되 칭찬을 사실처럼 지어내지 않는다.",
        },
    }
    age_guidance = {
        "infant": "영아의 감각 탐색·몸짓·반복 행동 중 실제 기록에 있는 행동을 구체적으로 쓴다.",
        "preschool": "유아의 설명·놀이 과정·또래 상호작용 중 실제 기록에 있는 행동을 구체적으로 쓴다.",
    }.get(age_band, "연령 정보가 없으므로 연령에 따른 해석 없이 관찰된 행동만 쓴다.")
    focus_guidance = {
        "general": "자료에 나타난 행동을 골고루 다룬다.",
        "communication": "기록된 발화·듣기·표현 행동에 초점을 둔다.",
        "play": "관찰된 놀이의 도구·행동·순서를 구체적으로 쓴다.",
        "expression": "관찰된 표정·몸짓만 쓰고 내면 감정을 추측하지 않는다.",
    }[focus]
    return json.dumps(
        {
            "age_band": age_band,
            "focus": focus,
            "source": "아이담 근거 중심 작성 가이드 v1",
            **guides[name],
            "age_guidance": age_guidance,
            "focus_guidance": focus_guidance,
        },
        ensure_ascii=False,
    )
