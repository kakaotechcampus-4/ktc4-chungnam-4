# 멀티에이전트 검증 방법

관련 요구사항: FR-05·FR-06·FR-07·FR-27, H-1~H-4.

## 현재 구현 구조도

![아이담 멀티에이전트: 일별 1→3→4, 월별 1→2→4, 원본 근거로 독립 검증](multi-agent-architecture.png)

[확대 PNG](multi-agent-architecture.png) · [수정 가능한 SVG 원본](multi-agent-architecture.svg)

- 일별 알림장은 Agent1의 요약을 Agent3가 작성하고, 월별 관찰일지는 Agent2가 작성합니다.
- Agent1·2·3은 네이티브 도구 호출을 사용합니다. Agent4는 생성 대화를 공유하지 않고 원본 비식별 근거로 검증합니다.
- 회색 박스는 코드 처리, 번호가 붙은 박스는 AI 역할입니다. 보라색 점선은 원본 근거 전달, 주황색 점선은 실패 처리입니다.
- 코드 검사·Critic 내용 실패는 해당 작성 에이전트로, Critic 응답 형식 오류는 Critic으로 돌아갑니다. 재시도 상한 뒤에는 확인 필요 또는 실패 사유를 안내합니다.
- 이 그림은 PR #259의 구현을 설명합니다. 실행 흐름을 바꾸면 SVG와 PNG를 함께 갱신합니다. 후속 범위는 아래 남은 고도화 절과 테크스펙을 참고합니다.

## 자동 검증

| 검증 | 방법 | 확인하는 것 |
| --- | --- | --- |
| 네이티브 도구 | `tests/agents/test_multi_agent.py`, `test_llm_gateway.py` | 모델이 고른 도구 실행 후 결과 전달, 임의 도구·ID·URL 거부, 필수 도구 누락·반복·입력 상한에서 종료 |
| 사진 알림장 | `tests/agents/test_photo_pipeline.py` | API→근거 요약→도구 조회→작성→Critic→저장→교사 승인/게시→자녀 연결된 학부모 열람. 외부 AI·S3만 고정 응답 |
| 월별 관찰일지 | `tests/agents/test_monthly_pipeline.py` | 게시 알림장 조회→요약→관찰일지 작성→영역/원본 문서 근거 저장→승인, 빈 월·회수본·다른 원아·학부모 권한·중복 요청 차단 |
| 화면 | `ObservationGenerator.test.tsx` 등 Vitest | 자료 0건 차단, 월별 요청과 검토 링크, 실패 안내·재시도 요청 ID 유지 |
| 기존 동작 | 전체 pytest, `pnpm check`, `pnpm build` | 기존 문서·동의·권한·일별 생성과 프론트 회귀 검사 |

저장소 루트 기준:

```bash
cd backend
python -m pytest -q
ruff check .
ruff format --check .
```

```bash
cd frontend
pnpm check
pnpm build
```

## 실제 모델 호출

로컬 worker의 기존 환경설정을 사용해 GLM-5.3-Flash에 합성 관찰 1건을 전송했다.
알림장: collector→감정 어휘/발달 문안 도구→parent_note→Critic 통과.
관찰일지: collector→영역 스타일/발달 지침 도구→observation→Critic 통과.
두 문서 모두 첫 작성에서 통과했고, 전체 점검은 약 10초였다. 단일 합성 예제의 연결 확인 결과이며 품질 평가 점수가 아니다.

처음에는 요약 응답의 JSON 코드 블록과 뒤에 붙은 설명 때문에 형식 검사에서 실패했다.
JSON 하나를 감싼 코드 블록만 허용하고, 설명이 붙은 응답은 거절·재시도하도록 했다.
`parent_note`가 교사의 게시 알림장이라는 뜻과 `shared_with_others`의 의미도 프롬프트에 명시했다.
이 실패 형태는 고정 응답 회귀 테스트로 남겼다.

PR 코드를 로컬 환경에 반영한 뒤, backend 폴더에서 재현한다. 실제 호출 비용이 발생한다.

```bash
python -m scripts.check_multi_agent --live
```

Compose worker 이미지를 이 브랜치로 빌드한 환경에서는:

```bash
docker compose exec worker python -m scripts.check_multi_agent --live
```

이 명령은 합성 텍스트만 사용하고 DB·S3·계정 데이터를 수정하지 않는다. 키나 모델 응답 원문 대신 역할·도구·판정만 출력한다. 조회 도구의 DB 연결은 위 API 통합 테스트에서 따로 검증한다.

## DB 변경과 배포 확인

로컬 PostgreSQL의 별도 임시 DB에서 전체 migration upgrade→이번 migration downgrade→upgrade를 확인하고 임시 DB를 삭제했다. 기존 앱 DB는 변경하지 않았다.
배포 시 API·worker 양쪽에 같은 코드를 반영하고 Alembic head까지 적용해야 한다.

AWS 배포 웹사이트에서 이 브랜치의 전체 흐름을 시연한 결과는 아니다. 머지·배포 후 사진/음성 실제 자료와 여러 원아로 반복 시연하고, Claude 모델을 사용하는 환경에서도 도구 호환성·소요시간을 추가 확인해야 한다.

## 남은 고도화

긴 월별 자료의 분할 요약, 원별 양식 업로드·내려받기, 공식 지침 데이터셋 검토, 교사 페르소나, Langfuse 연동, 여러 실패 유형을 포함한 AI 품질 평가셋은 후속 작업이다.
