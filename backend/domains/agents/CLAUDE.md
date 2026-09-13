# ⑤ agents — AI 에이전트 파이프라인

모인 자료로 관찰일지·알림장 초안을 만들고 검증합니다. 담당: 정은 (AI 리드와 협업). 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md).

## 파일 (목표 구조·구현 예정 포함)

| 파일 | 내용 |
| --- | --- |
| `models.py` | `EvidenceBundle`, `SentenceEvidence`, `VerificationResult` |
| `schemas.py` | 파이프라인 요청·응답 |
| `router.py` | 직접 API가 필요한 경우만 (예: 수동 재생성 요청) |
| `service.py` | 근거수집 → 초안생성 → Critic 검증 오케스트레이션 |
| `llm.py` | LLM 직접 호출 |
| `tasks.py` | Celery 파이프라인 실행 |

## 규칙

- **이 도메인만 최상위 `tools/`, `prompts/`를 호출합니다.** 호출 주체는 `service.py` 하나로 제한합니다.
- `tools/`, `prompts/`는 AI 담당 영역입니다. FastAPI·Celery를 모르는 순수 함수/텍스트로 유지하고, 백엔드 사정으로 그 안에 프레임워크 코드를 넣지 않습니다.
- **LLM 입력은 비식별 텍스트 + 동의 원아의 활동 사진·영상 프레임**입니다 (H-2). 실명은 파이프라인 3단계에서 `CHILD_A` 토큰으로 치환하고 매핑 테이블은 서버 내부에만 둡니다. 실명·생년월일·학부모 정보·얼굴 임베딩은 LLM에 보내지 않으며, 프롬프트·로그·Langfuse에도 실명이 남지 않게 합니다.
- 이미지는 교사가 업로드 대상으로 확정하고 미식별·미동의 얼굴 블러를 완료한 것만 선별합니다. 아이 1명·하루 기준 3~5장 권장으로 전송량을 제한하며, 정확한 상한은 확정 예정입니다.
- `tasks.py`는 호출만 하고 로직을 갖지 않습니다. 오케스트레이션은 `service.py`에.
- 재시도 상한을 넘기면 예외로 터뜨리지 말고 documents의 미분류함으로 떨어뜨립니다.
- 생성 문장은 `SentenceEvidence`로 근거(미디어·타임스탬프·원문)를 남깁니다. 근거 없는 문장은 통과시키지 않습니다.
- 여기서 만든 것은 항상 **초안**입니다. 교사 검수를 위한 초안 저장·조회는 허용하되 학부모 공개·외부 공유는 승인 전 금지합니다. 승인 상태를 이 도메인에서 바꾸지 않습니다 (H-1).
- 테스트에서 LLM을 실제로 호출하지 않습니다. 응답은 픽스처로 고정.
- 모델 스냅샷·API 키는 `core/config.py`의 `Settings`에서 읽습니다.

## 다른 도메인과의 관계

- `media`: 업로드 완료 후 트리거, `MediaAsset`·`TranscriptSegment` 참조
- `organization`: `Child`, `TeacherPersona`, `EducationPlan` 참조
- `documents`: 생성한 초안을 `DraftDocument`로 넘김
