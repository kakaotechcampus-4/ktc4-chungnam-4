from collections.abc import Sequence

import openai
from openai import OpenAI
from openai.types.chat import ChatCompletion

from core.config import get_settings

# 다시 부르면 풀릴 수 있는 호출 실패만 재시도 대상입니다 (테크스펙 예외 처리 표: "LLM 호출
# 실패, 타임아웃"). 인증·요청 형식 오류는 다시 불러도 같아서 넣지 않습니다.
# APITimeoutError는 APIConnectionError의 하위 클래스라 함께 잡힙니다.
RETRYABLE_LLM_ERRORS: tuple[type[Exception], ...] = (
    openai.APIConnectionError,
    openai.RateLimitError,
    openai.InternalServerError,
)

# SDK 기본값(10분)이면 Celery soft_time_limit(180초)이 먼저 끊어 버림
# 1회 호출 상한을 둬서 느린 호출은 SDK가 끊고 오류로 올림 (테크스펙 파이프라인 4단계)
_TIMEOUT_SECONDS = 30

# 재시도는 Celery(tasks.py, 상한 2회) 한 곳에서만 함. SDK 기본 재시도(2회)를 두면 겹쳐서
# 실패한 호출 한 지점에서 HTTP 요청이 최대 3×3=9번 나가고, Job.retry_count에는 Celery
# 재시도만 남음 (#102 리뷰, 엄태은)
_SDK_MAX_RETRIES = 0

# 사진 분석 응답 상한. 스파이크에서 아이 4명 사진 1건이 1,618토큰까지 나와 1024로는 잘릴 수 있다
# (#179 리뷰, 유진). 과금은 실제 출력 토큰 기준이라 상한을 올려도 평소 비용은 같다.
_VISION_MAX_TOKENS = 2048

# 초안 생성·Critic 응답 상한. 1024에서 응답이 중간에 잘려 JSON이 깨진 사례가 있어(4명 중 2명 실패,
# 11/2 로컬 실행) 상한을 늘렸다. Claude 게이트웨이의 2000 상한에도 맞춘다(#258).
_TEXT_MAX_TOKENS = 2000


def _complete(*, endpoint: str, model: str, messages: list[dict], max_tokens: int) -> str | None:
    """설정된 API base URL 또는 완전한 chat/completions 주소를 사용한다(FR-05).

    필요한 API 버전 경로(/v1 등)는 환경설정에 포함한다. 호스트별로 추정하지 않는다.
    SDK의 인증·시간 초과·재시도 예외 계약은 유지한다.
    """
    settings = get_settings()
    endpoint = endpoint.rstrip("/")
    is_complete_url = endpoint.endswith("/chat/completions")
    with OpenAI(
        api_key=settings.anthropic_api_key.get_secret_value(),
        base_url=endpoint,
        timeout=_TIMEOUT_SECONDS,
        max_retries=_SDK_MAX_RETRIES,
    ) as client:
        body = {"model": model, "max_tokens": max_tokens, "messages": messages}
        # 이 모델은 추론 끄기를 지원하지 않는다. 공식 모델 정보의 low를 사용해
        # 추론만 하다 출력 한도·30초 제한을 소진하는 일을 줄인다.
        if model == "zai-org/GLM-5.3-Flash" or model.startswith("anthropic/claude-"):
            body["reasoning_effort"] = "low"
        if is_complete_url:
            response = client.post(endpoint, cast_to=ChatCompletion, body=body)
        else:
            response = client.chat.completions.create(**body)
        return response.choices[0].message.content if response.choices else None


def call_claude(prompt: str) -> str | None:
    settings = get_settings()
    return _complete(
        endpoint=settings.llm_gateway_base_url,
        model=settings.anthropic_model,
        max_tokens=_TEXT_MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )


def call_vision(instructions: str, image_urls: Sequence[str]) -> str | None:
    """사진 분석 모델(GLM, 엘리스 ML API)을 부른다 (파이프라인 5단계, NFR-09).

    image_urls는 prompts/perception의 images 순서대로 붙인다. 서명 URL(https)과
    data URL(base64)을 모두 받는다 — 지금은 서버가 S3 서명 URL을 넘긴다.
    본문이 없으면 None을 돌려준다. 파서가 응답 오류로 다룬다.

    키는 Claude와 같은 캠퍼스 게이트웨이 키를 쓰고 주소·모델만 따로 둔다
    (.env.example, #98). TODO(eun): 게이트웨이가 URL 이미지를 받지 않으면 S3에서 읽어
    data URL로 바꾼다. HEIC는 모델이 읽지 못할 수 있어 JPEG 변환이 필요하다(Pillow, 팀 확인).
    """
    settings = get_settings()
    content: list[dict] = [{"type": "text", "text": instructions}]
    content += [{"type": "image_url", "image_url": {"url": url}} for url in image_urls]
    return _complete(
        endpoint=settings.vision_gateway_base_url,
        model=settings.vision_model,
        max_tokens=_VISION_MAX_TOKENS,
        messages=[{"role": "user", "content": content}],
    )


if __name__ == "__main__":
    # 연결 확인용 1회성 스크립트 — pytest에 포함하지 않음 (CLAUDE.md §11: LLM 실제 호출 금지)
    # H-2: 실제 아동 정보 대신 더미 텍스트만 사용
    print(call_claude("CHILD_A가 오늘 블록 놀이를 했다는 내용으로 한 문장만 만들어줘."))


def call_agent(messages: list[dict], tools: list[dict]) -> openai.types.chat.ChatCompletionMessage:
    """역할별 독립 대화의 네이티브 도구 호출. 도구 실행 권한은 service가 검사한다(FR-05)."""
    settings = get_settings()
    endpoint = settings.llm_gateway_base_url.rstrip("/")
    with OpenAI(
        api_key=settings.anthropic_api_key.get_secret_value(),
        base_url=endpoint,
        timeout=_TIMEOUT_SECONDS,
        max_retries=0,
    ) as client:
        body = {
            "model": settings.anthropic_model,
            "messages": messages,
            "max_tokens": _TEXT_MAX_TOKENS,
            "tools": tools,
            "tool_choice": "auto",
        }
        if (
            settings.anthropic_model == "zai-org/GLM-5.3-Flash"
            or settings.anthropic_model.startswith("anthropic/claude-")
        ):
            body["reasoning_effort"] = "low"
        response = (
            client.post(endpoint, cast_to=ChatCompletion, body=body)
            if endpoint.endswith("/chat/completions")
            else client.chat.completions.create(**body)
        )
        if not response.choices or response.choices[0].finish_reason not in {"stop", "tool_calls"}:
            # 본문·키·공급자 오류 원문은 로그에 남기지 않는다.
            raise ValueError("AGENT_INCOMPLETE_RESPONSE")
        return response.choices[0].message
