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

- **파일 바이트는 서버를 통과하지 않습니다.**
- 완료 통지는 신뢰할 수 없는 입력입니다. 실제 객체 존재와 크기·타입을 확인한 뒤 `MediaAsset`을 확정하세요.
- URL 만료는 짧게. S3 자격증명은 `core/config.py`의 `Settings`에서만 읽습니다.
- `MediaChildLink.method`는 `face_recognition`(로컬 자동) / `manual`(로컬 수동) 둘뿐입니다. `confidence_score`는 자동일 때만 채웁니다.
- **`MediaAsset.llm_allowed`가 false면 agents로 넘기지 않습니다** (H-2). 기본값은 false이고 교사 확정으로만 true가 됩니다 — 값이 없거나 애매하면 **제외되는 쪽으로 실패**시킵니다.
- `MediaChildLink`가 미디어–원아 귀속입니다. 귀속이 안 잡힌 건 버리지 말고 미분류로 남겨 documents의 미분류함으로 흘려보냅니다.
- **귀속 판정은 온디바이스 얼굴 인식 단독입니다** (09/15 결정, 파이프라인 2단계). 서버는 판정하지 않고 교사 검수를 마친 확정 결과만 받아 씁니다 — 호명 발화로 귀속을 보정하는 서버 로직을 만들지 마세요. 호명은 초안 작성 근거로만 쓰입니다.
- `TranscriptSegment`는 STT 결과 구간. 실명이 섞여 들어올 수 있으니 agents로 넘기기 전 비식별화를 거칩니다 (H-2).
- **STT는 외부 STT 서비스를 서버가 호출해 만듭니다** (09/13 결정, 파이프라인 1-B). 브라우저가 외부 STT를 직접 부르지 않습니다 — 키가 노출됩니다. 제공자·호출 위치(동기 vs Celery)는 미정이라 `docs/open-questions.md`를 확인하고, 정해지기 전에는 호출 지점을 service 함수 하나로 좁혀 두세요.
- 외부 STT로 나가는 것은 **오디오뿐**입니다. 원아 이름·반 정보·`child_id`를 함께 보내지 않습니다 — 위탁 전송은 필요한 것만. 발화 안에 실명 호명이 들어 있는 건 어쩔 수 없고 그건 H-2 대상이 아닙니다(H-2는 LLM으로 나가는 것을 규정하며, LLM에는 비식별화 후 텍스트만 갑니다). STT 요청·응답 로그에 발화 원문을 찍지 않습니다 (H-4).
- **블러는 없습니다** (09/13 폐기). `MediaAsset.redacted` 컬럼은 **만들지 않습니다** — 마이그레이션에 넣지 말고, 블러가 부활하면 그때 추가합니다 (09/21).
- **프록시본·썸네일은 "사본 금지"의 예외입니다** — 원본에서 만드는 파생본입니다(`proxy_url`·`thumbnail_url`·`derivative_state`). 변환 실행 위치는 미정입니다(ffmpeg 의존성 · Celery 범위).
- 사진은 미동의 원아가 함께 찍혔더라도 S3에 올립니다 — 업로드는 필수 동의(②) 범위입니다. 미동의 원아 보호는 **`MediaChildLink` 귀속 결과를 보고 LLM 경로에서 빼는 것**으로 합니다 (H-2). agents에 미디어를 넘기는 지점에서 이 검사를 거치세요.
- agents 트리거는 지금 단계에선 `service.py`에서 `.delay()` 한 줄로 처리합니다. `tasks.py`는 media 전용 작업이 생길 때 채웁니다.

## 다른 도메인과의 관계

- `organization`: `Child` FK, 동의 없는 원아 미디어는 수집 대상 제외
- `agents`: 저장 완료 후 파이프라인 트리거, `EvidenceBundle`이 `MediaAsset`·`TranscriptSegment` 참조
