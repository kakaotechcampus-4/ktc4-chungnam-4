# ④ media — 업로드 미디어 처리

S3 업로드용 URL을 내주고 그 결과 메타데이터만 DB에 기록합니다. 담당: 김동건. 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md).

## 파일 (목표 구조·구현 예정 포함)

| 파일 | 내용 |
| --- | --- |
| `models.py` | `MediaAsset`, `MediaUpload`(업로드 URL 발급 기록), `MediaChildLink`, `TranscriptSegment` |
| `schemas.py` | presigned URL 요청·응답, 업로드 완료 통지 |
| `router.py` | presigned URL 발급, 업로드 완료 통지 API |
| `service.py` | presigned URL 발급 + 완료 통지 시 메타데이터 저장 |
| `audio.py` | STT 직전 음성 추출(ffmpeg)·말소리 구간 찾기·28초 이하 조각 |
| `stt.py` | 엘리스 Whisper 조각 호출(동시 호출·조각 단위 재시도) |
| `tasks.py` | media 전용 Celery 작업 — STT(`transcribe_media`) |

## 규칙

- **업로드 때 파일 바이트는 서버를 통과하지 않습니다** — 브라우저가 presigned URL로 S3에 직접 올립니다. 예외는 STT입니다: worker가 S3 원본을 임시 폴더에 받아 음성만 뽑고 바로 지웁니다(파이프라인 1-B). 영상은 화면과 소리가 섞여 저장돼 소리만 받을 수 없습니다.
- 완료 통지는 신뢰할 수 없는 입력입니다. 실제 객체 존재와 크기·타입을 확인한 뒤 `MediaAsset`을 확정하세요.
- URL 만료는 짧게. S3 자격증명은 `core/config.py`의 `Settings`에서만 읽습니다.
- `MediaChildLink.method`는 `face_recognition`(로컬 자동) / `manual`(로컬 수동) 둘뿐입니다. `confidence_score`는 자동일 때만 채웁니다.
- **`MediaAsset.llm_allowed`가 false면 agents로 넘기지 않습니다** (H-2). 기본값은 false이고 교사 확정으로만 true가 됩니다 — 값이 없거나 애매하면 **제외되는 쪽으로 실패**시킵니다.
- `MediaChildLink`가 미디어–원아 귀속입니다. 귀속이 안 잡힌 건 버리지 말고 미분류로 남겨 documents의 미분류함으로 흘려보냅니다.
- **귀속 판정은 온디바이스 얼굴 인식 단독입니다** (09/15 결정, 파이프라인 2단계). 서버는 판정하지 않고 교사 검수를 마친 확정 결과만 받아 씁니다 — 호명 발화로 귀속을 보정하는 서버 로직을 만들지 마세요. 호명은 초안 작성 근거로만 쓰입니다.
- `TranscriptSegment`는 STT 결과 구간. 실명이 섞여 들어올 수 있으니 agents로 넘기기 전 비식별화를 거칩니다 (H-2).
- **STT는 외부 STT 서비스를 서버가 호출해 만듭니다** (09/13 결정, 파이프라인 1-B). 브라우저가 외부 STT를 직접 부르지 않습니다 — 키가 노출됩니다. 제공자는 엘리스 ML API의 Whisper Large v3이고, 호출은 media가 Celery worker에서 합니다(#142, #185). 호출 지점은 service 함수 하나로 좁혀 둡니다.
  - 설정은 사진 분석(`VISION_*`)과 따로 `STT_*`로 둡니다. 요청에는 `language=korean`·`return_timestamps=true`를 반드시 붙입니다 — 없으면 구간 시각이 오지 않거나 다른 언어로 인식합니다(#142 송유진 실측).
  - 무음에서 생기는 헛문장("감사합니다." 등)은 서버가 자동으로 지우지 않습니다. 교사가 발화 검수에서 뺍니다(#142).
- 외부 STT로 나가는 것은 **오디오와 그 반 원아의 성명·호칭 목록(`prompt`)뿐**입니다. 이름 목록은 교사가 호칭이나 성명으로 부른 원아 이름을 같은 글자로 받아 적게 하려고 붙입니다(팀 논의 11/05, 테크스펙 파이프라인 1-B). `child_id`·반 정보·보호자 정보는 함께 보내지 않습니다 — 위탁 전송은 필요한 것만. 발화 안에 실명 호명이 들어 있는 건 어쩔 수 없고 그건 H-2 대상이 아닙니다(H-2는 LLM으로 나가는 것을 규정하며, LLM에는 비식별화 후 텍스트만 갑니다). STT 요청·응답 로그에 발화 원문·이름 목록을 찍지 않습니다 (H-4).
  - prompt에는 원아마다 성명 다음 호칭을 두고(성명 가나다순), 쉼표로만 잇고 다른 문구를 넣지 않습니다. 소개 문장이나 말투 예시를 넣으면 이름 인식이 떨어지고, 소음 속에서 그 문장을 그대로 지어냅니다(11/05 합성 음성 실험).
  - 전사 구간이 반 원아 이름(조사 포함)만으로 이루어지고 서로 다른 이름이 4개 이상이면, prompt를 그대로 읊은 것으로 보고 저장하지 않습니다. 소음 속에서 이름 목록을 통째로 지어내 반 아이들이 모두 근거에 나오는 것을 막기 위함입니다.
- **STT 결과는 저장하기 전에 이름 바로잡기(파이프라인 1-C)를 거칩니다** (H-2 예외, 팀 승인 대기 #268). 교사가 발화 검수 화면에서 처음 볼 때부터 이름이 바로잡혀 있게 하려는 것입니다 — STT가 끝난 뒤 따로 고치면 교사가 고치기 전 문장을 먼저 봅니다.
  - LLM 호출은 agents의 `fix_transcript_names`가 합니다(LLM 단계는 agents만 부름, `backend/CLAUDE.md` §계층 규칙). media는 `transcribe_media`에서 저장 직전에 부릅니다. agents가 media를 import하므로 함수 안에서 import합니다.
  - 보내는 것은 반 원아 성명·호칭과 전사문뿐입니다. `STT_NAME_FIX_ENABLED`가 켜져 있을 때만 돌고, 실패한 묶음은 STT 결과를 그대로 저장합니다.
  - 바로잡은 문장은 `raw_text`에 들어가고 원래 STT 문장은 남기지 않습니다. 바뀐 이름을 검수 화면에서 강조하려면 원래 문장을 남길 칸이 필요해 후속으로 둡니다(미정).
- **블러는 없습니다** (09/13 폐기). `MediaAsset.redacted` 컬럼은 **만들지 않습니다** — 마이그레이션에 넣지 말고, 블러가 부활하면 그때 추가합니다 (09/21).
- **프록시본·썸네일은 "사본 금지"의 예외입니다** — 원본에서 만드는 파생본입니다(`proxy_url`·`thumbnail_url`·`derivative_state`). 변환 실행 위치는 미정입니다(ffmpeg 의존성 · Celery 범위).
- 사진은 미동의 원아가 함께 찍혔더라도 S3에 올립니다 — 업로드는 필수 동의(②) 범위입니다. 미동의 원아 보호는 **`MediaChildLink` 귀속 결과를 보고 LLM 경로에서 빼는 것**으로 합니다 (H-2). agents에 미디어를 넘기는 지점에서 이 검사를 거치세요.
- agents 트리거는 지금 단계에선 `service.py`에서 `.delay()` 한 줄로 처리합니다. media 전용 작업은 `tasks.py`에 두고, API는 커밋한 뒤에 작업을 넣습니다(worker가 커밋된 행을 읽음).

## 다른 도메인과의 관계

- `organization`: `Child` FK, 동의 없는 원아 미디어는 수집 대상 제외
- `agents`: 저장 완료 후 파이프라인 트리거, `EvidenceBundle`이 `MediaAsset`·`TranscriptSegment` 참조. STT 직후 agents의 `fix_transcript_names`(1-C)를 부름
