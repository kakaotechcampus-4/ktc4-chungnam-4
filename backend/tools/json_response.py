"""앞의 짧은 설명·코드 펜스만 허용하고 마지막 JSON 전체를 엄격하게 읽는다."""

import json
import re


def parse_json_response(raw: str | None) -> object:
    """스키마·참조 검증은 호출자가 수행한다. 복수 JSON·잘린 JSON은 복구하지 않는다."""
    text = (raw or "").strip()
    # JSON 안의 문자열에 포함된 펜스는 건드리지 않는다.
    if text.startswith(("{", "[")):
        return json.loads(text)
    fenced = re.fullmatch(r"([^\[\{`]*?)```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(2))
    start = re.search(r"[\[{]", text)
    if start and "`" not in text[: start.start()]:
        return json.loads(text[start.start() :])
    raise ValueError("응답에 완전한 JSON이 없습니다.")
