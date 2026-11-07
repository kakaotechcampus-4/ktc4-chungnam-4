"""네이티브 tool_calls 응답 픽스처. 외부 AI만 대체하고 서버 도구·파서는 실제 실행한다."""

import json
from collections.abc import Callable

from openai.types.chat import ChatCompletionMessage


def native_fixture(final: Callable[[str], str]) -> Callable:
    def respond(messages: list[dict], tools: list[dict]) -> ChatCompletionMessage:
        names = [tool["function"]["name"] for tool in tools]
        prompt = messages[0]["content"]
        if "activity_plan" in names:
            data = prompt.split("\n관찰 자료:\n", 1)[1].split("\n이전 응답", 1)[0]
            items = json.loads(data)
            return ChatCompletionMessage(
                role="assistant",
                content=json.dumps(
                    {
                        "facts": [
                            {"text": item["text"][:200], "evidence_refs": [item["ref"]]}
                            for item in items[:10]
                        ]
                    },
                    ensure_ascii=False,
                ),
            )
        if not any(message["role"] == "tool" for message in messages):
            return ChatCompletionMessage.model_validate(
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": f"call_{name}",
                            "type": "function",
                            "function": {"name": name, "arguments": "{}"},
                        }
                        for name in names
                    ],
                }
            )
        return ChatCompletionMessage(role="assistant", content=final(prompt))

    return respond
