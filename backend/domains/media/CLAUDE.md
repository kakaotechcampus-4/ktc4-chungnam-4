# media — 원본 미디어 · 인식 결과 (파이프라인 0~2단계)

담당: 미정

## 소유 테이블

| 테이블 | 핵심 필드 | 메모 |
|---|---|---|
| `MediaAsset` | id, type, captured_at, storage_url, storage_tier, redacted, model_version, retention_expires_at | `retention_expires_at`은 `Child.graduated_at` 기준으로 산출 (NFR-03) |
| `MediaChildLink` | id, method, confidence_score | 사진-아이 매칭 결과. `method`로 얼굴/호명 교차검증 근거를 남김 |
| `TranscriptSegment` | id, start_time, end_time, raw_text, source | 영상 속 음성 STT 결과 |

## 요구사항

- FR-04 업로드 후 아이별 자동 분류 · FR-14 수동 분류 · FR-15 로컬 파일 업로드

## 규칙

- **원본 얼굴 이미지는 서버로 올라오지 않습니다** (H-3). 여기서 다루는 건 교사가 업로드한 사진·영상 파일과 그 인식 결과입니다.
- 파기는 물리 삭제가 아니라 `DeletionLog` 기록과 함께 (NFR-04). `audit` 도메인 참조.
- 분류 실패는 예외가 아니라 **미분류함**으로 보냅니다. `throw`로 배치를 끊지 않습니다.
- 100~150장 배치를 전제로 합니다. 건별 동기 처리를 가정하지 마세요.

## 미정

- `UnclassifiedItem` 소유 도메인 — media vs documents
- 영상·음성 파일이 없는 날의 서비스 동작
- 원본 파일 스토리지 (`storage_tier` 계층 정책)
