import os

import anthropic

# TODO(eun): core/config.py의 Settings가 생기면 os.getenv 대신 core.config.settings로 교체
_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")


def call_claude(prompt: str) -> str:
    client = anthropic.Anthropic(api_key=_ANTHROPIC_API_KEY)
    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


if __name__ == "__main__":
    # 연결 확인용 1회성 스크립트 — pytest에 포함하지 않음 (CLAUDE.md §11: LLM 실제 호출 금지)
    # H-2: 실제 아동 정보 대신 더미 텍스트만 사용
    print(call_claude("CHILD_A가 오늘 블록 놀이를 했다는 내용으로 한 문장만 만들어줘."))
