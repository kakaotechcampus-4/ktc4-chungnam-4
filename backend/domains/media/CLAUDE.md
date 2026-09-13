# ④ media — 업로드 미디어 처리

S3 업로드용 URL을 내주고 그 결과 메타데이터만 DB에 기록합니다. 담당: 김동건. 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md).

## 파일 (목표 구조·구현 예정 포함)

| 파일 | 내용 |
| --- | --- |
| `models.py` | `MediaAsset`, `MediaChildLink`, `TranscriptSegment` |
| `schemas.py` | presigned URL 요청·응답, 업로드 완료 통지 |
| `router.py` | presigned URL 발급, 업로드 완료 통지 API |
| `service.py` | presigned URL 발급 + 완료 통지 시 메타데이터 저장 |
| `tasks.py` | media 전용 백그라운드 작업 (썸네일 등) |

## 규칙

- **파일 바이트는 서버를 통과하지 않습니다.** 브라우저가 presigned URL로 S3에 직접 올리고, 서버는 완료 통지만 받아 메타데이터를 씁니다.
- 완료 통지는 신뢰할 수 없는 입력입니다. 실제 객체 존재와 크기·타입을 확인한 뒤 `MediaAsset`을 확정하세요.
- URL 만료는 짧게. S3 자격증명은 `core/config.py`의 `Settings`에서만 읽습니다.
- `MediaChildLink`가 미디어–원아 귀속입니다. 귀속이 안 잡힌 건 버리지 말고 미분류로 남겨 documents의 미분류함으로 흘려보냅니다.
- `TranscriptSegment`는 STT 결과 구간. 실명이 섞여 들어올 수 있으니 agents로 넘기기 전 비식별화를 거칩니다 (H-2).
- **STT는 외부 STT 서비스를 서버가 호출해 만듭니다** (09/13 결정, 파이프라인 1-B). 브라우저가 외부 STT를 직접 부르지 않습니다 — 키가 노출됩니다. 제공자·호출 위치(동기 vs Celery)는 미정이라 `docs/open-questions.md`를 확인하고, 정해지기 전에는 호출 지점을 service 함수 하나로 좁혀 두세요.
- 외부 STT로 나가는 것은 **오디오뿐**입니다. 원아 이름·반 정보·`child_id`를 함께 보내지 않습니다 — 위탁 전송은 필요한 것만. 발화 안에 실명 호명이 들어 있는 건 어쩔 수 없고 그건 H-2 대상이 아닙니다(H-2는 LLM으로 나가는 것을 규정하며, LLM에는 비식별화 후 텍스트만 갑니다). STT 요청·응답 로그에 발화 원문을 찍지 않습니다 (H-4).
- 미동의 원아 얼굴이 블러된 사본이 올라온 경우 `MediaAsset.redacted`를 참으로 기록합니다. 서버에는 블러본만 존재하므로 학부모 열람도 같은 객체를 봅니다 (09/13 다인원 사진 결정).
- agents 트리거는 지금 단계에선 `service.py`에서 `.delay()` 한 줄로 처리합니다. `tasks.py`는 media 전용 작업이 생길 때 채웁니다.

## 다른 도메인과의 관계

- `organization`: `Child` FK, 동의 없는 원아 미디어는 수집 대상 제외
- `agents`: 저장 완료 후 파이프라인 트리거, `EvidenceBundle`이 `MediaAsset`·`TranscriptSegment` 참조
