from openai import OpenAI

from core.config import get_settings

# 테크스펙엔 "Claude Sonnet 계열"이라고만 되어 있고, 나중에 모델명이 바뀔 수 있음
# 게이트웨이의 모델 ID 형식(제공자/모델명)을 그대로 사용
_MODEL = get_settings().anthropic_model


def call_claude(prompt: str) -> str:
    settings = get_settings()
    client = OpenAI(
        api_key=settings.anthropic_api_key.get_secret_value(),
        base_url=settings.anthropic_base_url,
    )
    response = client.chat.completions.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content


if __name__ == "__main__":
    # 연결 확인용 1회성 스크립트 — pytest에 포함하지 않음 (CLAUDE.md §11: LLM 실제 호출 금지)
    # H-2: 실제 아동 정보 대신 더미 텍스트만 사용
    print(call_claude("CHILD_A가 오늘 블록 놀이를 했다는 내용으로 한 문장만 만들어줘."))
