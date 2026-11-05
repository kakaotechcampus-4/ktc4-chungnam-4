"""에이전트별 독립 시스템 지시. 프롬프트 본문은 같은 디렉터리의 Markdown이다."""

import re
from functools import cache
from pathlib import Path

PROMPT_VERSION = "multi_agent.v2"


@cache
def role_prompt(role: str) -> str:
    names = {"collector": "collector.md", "observation": "observation_log.md"}
    text = Path(__file__).with_name(names[role]).read_text(encoding="utf-8")
    if not text.startswith("<!--"):
        raise RuntimeError("에이전트 프롬프트의 입출력 주석이 없습니다.")
    return re.sub(r"\A<!--.*?-->\s*", "", text, count=1, flags=re.DOTALL)
