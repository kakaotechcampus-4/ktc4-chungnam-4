# media · face API — 업로드·귀속·재생 URL·얼굴 임베딩

> 담당 김동건

> 표기(상세 작성·경로만·`(제안)`·`[확인 필요]`)와 어느 문서가 원본인지는 [README](README.md)에 있습니다. 공통 규약은 테크스펙 §공통 API 규약과 README §공통 규약 중 테크스펙에 없는 것에 있습니다.

## 정해 주셔야 할 것

(막힘)은 정해져야 FE 목(MSW)과 BE schemas를 만들 수 있는 항목입니다. 막히면 작업하는 사람이 정하고 진행합니다. 정한 값은 같은 PR에서 이 파일에 반영하고, 항목을 `[x]`로 바꾼 뒤 `임시 결정(이름)`과 반영한 곳을 적습니다([README](README.md) §이 문서를 읽는 법). 담당의 답은 이슈 #58 댓글이나 이 파일을 고치는 PR로 받습니다.

- [x] (막힘) child-links를 전체 교체(PUT)로 할지(PR #13 리뷰 [must]) → 임시 결정(김동건): 전체 교체. 보낸 목록이 최종 상태이고 빠진 원아의 링크는 지웁니다. 반영: 이 파일 `PUT /media/{media_id}/child-links` 절, backend `save_attributions`(브랜치 `feat/be/child-links-full-replace`, PR 전)
- [ ] (막힘) `llm_allowed` 최종값 계산 주체와 규칙(정은과 함께). 제안: 사진은 "교사 확인 AND ③ 동의", 영상·음성은 교사 확인값 → 하단 §상의 필요 3
- [ ] (막힘) 영상·음성메모도 child-links로 수동 귀속(정은과 함께). 음성메모 근거가 초안에 들어가기 위한 전제 → 하단 §상의 필요 2
- [ ] `attributed_at` 추가와, 이를 쓰는 Job의 `MEDIA_NOT_READY` 판정(정은과 함께)
- [ ] 업로드 한도, 허용 MIME, URL 만료(예시 PUT 15분·GET 5분), 멀티파트 필요 여부
- [ ] 파생본이 없어 HEIC·MOV가 안 보이는 문제. 데모 자료를 JPG·MP4로 제한할지
- [ ] `error.detail`을 object로 허용할지(develop `AidamError.detail`은 지금 str)
- [ ] `load_embedding_cache`가 `model_version`도 돌려주게 할지, 모델 버전 문자열을 어떻게 배포할지
- [ ] 서명 함수(`get_signed_urls`, 가칭) 제공과 documents 응답 내장 분담(한상균과 함께) → 하단 §상의 필요 5
- [ ] develop(PR #13)과 다른 점: 귀속 에러 코드 이름이 `MEDIA_INVALID_ATTRIBUTION_METHOD`(이 문서 `INVALID_ATTRIBUTION_METHOD`, 조건은 같음)이고, documents용 함수 `get_playback_url`은 한 건씩 서명·만료 없는 URL 문자열을 줌. 이 문서에 맞출지 develop에 맞출지(URL 함수는 한상균과 함께)
- [ ] 영상·음성 서버 STT를 어디서 시작할지(동기 vs Celery)
- [ ] `face/CLAUDE.md`의 `/face` 표기 수정

## 이 도메인의 규칙

media·face는 상세 작성 엔드포인트 7개(media 4, face 3)로 네 가지를 제공합니다.

- 브라우저에서 S3로 직접 올리는 업로드 통로: URL 발급 → 완료 통지 → 귀속 저장
- 근거 미디어를 재생할 짧은 만료의 서명 URL
- 온디바이스 분류에 쓰는 반 임베딩 캐시
- 얼굴 정보 등록·삭제(원아별 벡터)

**전제**

- 파일 바이트는 서버를 거치지 않습니다. `POST /media/upload-urls` → S3 `PUT` → `POST /media`(ack) → `PUT /media/{media_id}/child-links` 순서로 올라갑니다.
- 서버는 브라우저 로컬의 `review_state`를 검증할 수 없습니다. 확정된 사진과 영상·음성메모만 올리도록 FE의 `canUpload()`가 판단합니다.
- 재생 URL 객체는 모든 도메인에서 `{media_id, type, url, url_expires_at}` 한 가지 모양으로 씁니다(제안).
  - 서명은 media service 함수(`get_signed_urls`, 가칭)가 만듭니다.
  - documents는 이 함수를 불러 교사 초안 상세와 학부모 응답에 URL을 담습니다.
  - 학부모는 media 엔드포인트를 직접 부르지 않습니다(H-1).
- 상세 작성 범위에는 파생본(썸네일·프록시)이 없어 원본에 서명합니다.
- `method` 값 `face_recognition`/`manual`은 PR #13(09-22 머지)에서 정했습니다.

## 상세 작성 엔드포인트

### `POST /api/v1/media/upload-urls` — 여러 파일의 S3 업로드 URL(presigned PUT) 일괄 발급

- 쓰는 화면: 처리 중/서버 전송
- 요구사항: FR-15
- 권한: 교사 — 담당 반만
- 요청: `class_id`는 헤더에서 고른 반입니다. `items[]`의 각 항목에는 네 값을 넣습니다.
  - `client_photo_id`: 클라이언트가 만든 UUID. 사진은 `LocalPhoto.photo_id`를 쓰고, 영상·음성은 FE가 새로 만듭니다.
  - `type`: `photo` / `video` / `voice_memo`
  - `content_type`
  - `size_bytes`: 클라이언트가 선언한 크기

```json
{
  "class_id": "c1a50000-0000-4000-8000-000000000001",
  "items": [
    { "client_photo_id": "1c000000-0000-4000-8000-000000000041", "type": "photo", "content_type": "image/jpeg", "size_bytes": 2841233 },
    { "client_photo_id": "1c000000-0000-4000-8000-000000000044", "type": "voice_memo", "content_type": "audio/mp4", "size_bytes": 1204480 }
  ]
}
```

- 응답 `200`: 항목 순서는 요청과 같습니다.

```json
{
  "items": [
    {
      "client_photo_id": "1c000000-0000-4000-8000-000000000041",
      "media_id": null,
      "upload_url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Expires=900&X-Amz-Signature=…",
      "upload_headers": { "Content-Type": "image/jpeg" },
      "upload_url_expires_at": "2026-09-15T06:15:00Z"
    },
    {
      "client_photo_id": "1c000000-0000-4000-8000-000000000044",
      "media_id": "3ed1a000-0000-4000-8000-000000000044",
      "upload_url": null,
      "upload_headers": null,
      "upload_url_expires_at": null
    }
  ]
}
```

- `media_id`가 null이 아니면 이미 등록된 파일입니다. 다시 올리지 않고 귀속 단계로 넘어갑니다. 새로고침 뒤 이어 올릴 때 이 값을 씁니다.
- PUT 요청에는 `upload_headers`를 그대로 붙여야 서명이 맞습니다.
- 에러:
  - `MEDIA_TYPE_NOT_ALLOWED` (400) — 허용 형식(JPG·PNG·HEIC / MP4·MOV / M4A·WAV, Figma 기준)이 아니거나 `type`과 맞지 않을 때. 한 항목이라도 걸리면 요청 전체를 거절하고, 걸린 항목은 `detail.client_photo_ids`에 담습니다.
  - `UPLOAD_BATCH_TOO_LARGE` (400) — 파일 수나 크기가 상한을 넘을 때
  - `CLASS_ACCESS_DENIED` (403) — 담당 반이 아닐 때
  - `CLIENT_PHOTO_ID_CONFLICT` (409) — 같은 `client_photo_id`가 다른 반에 이미 있을 때
- [확인 필요: 김동건] 요청당 최대 파일 수, 파일당 최대 크기, URL 만료 시간(예시 15분), 82MB급 영상에 멀티파트 업로드가 필요한지 정해야 합니다.

### `POST /api/v1/media` — 업로드 완료 통지(서버가 S3 객체를 확인한 뒤 `MediaAsset` 확정)

- 쓰는 화면: 처리 중/서버 전송 — "14 / 21장"의 분자는 받은 응답 수입니다.
- 요구사항: FR-15
- 권한: 교사 — 담당 반만. `teacher_id`는 세션에서 채웁니다.
- 요청: 파일 하나당 한 번 부릅니다.
  - `client_photo_id`·`class_id`·`type`은 URL 발급 때와 같은 값입니다.
  - `captured_at`은 촬영 시각(UTC)으로, EXIF나 파일 메타데이터에서 읽습니다.
  - `model_version`은 사진만 채우고 영상·음성은 null입니다.

```json
{
  "client_photo_id": "1c000000-0000-4000-8000-000000000041",
  "class_id": "c1a50000-0000-4000-8000-000000000001",
  "type": "photo",
  "captured_at": "2026-09-15T01:10:00Z",
  "model_version": "buffalo_l-1.0"
}
```

- 서버는 통지 내용을 믿지 않습니다. 서버가 정한 객체 키로 S3 HeadObject를 불러 객체가 있는지, 크기와 타입이 맞는지 확인한 뒤에 행을 만듭니다.
- 응답 `201`: 새로 확정했을 때입니다. 같은 `client_photo_id`를 다시 보내면 기존 리소스를 `200`으로 돌려줍니다.

```json
{
  "media_id": "3ed1a000-0000-4000-8000-000000000041",
  "client_photo_id": "1c000000-0000-4000-8000-000000000041",
  "class_id": "c1a50000-0000-4000-8000-000000000001",
  "type": "photo",
  "captured_at": "2026-09-15T01:10:00Z",
  "size_bytes": 2841233,
  "llm_allowed": false,
  "attributed_at": null
}
```

- `media_id`는 `LocalPhoto.server_media_id`와 Job 요청의 `media_ids`에 씁니다.
- 이 응답이 ack입니다. 원본 blob은 이 응답을 받은 뒤에 지웁니다. 귀속 값은 귀속 저장이 끝날 때까지 로컬에 남겨 둡니다.
- `attributed_at`(제안)은 귀속을 저장하기 전이면 null입니다.
- 에러:
  - `MEDIA_UPLOAD_NOT_FOUND` (409) — S3에 객체가 없을 때(업로드 미완료, URL 만료). FE는 URL을 다시 받아 올립니다.
  - `MEDIA_UPLOAD_MISMATCH` (400) — 실제 타입이나 크기가 선언과 다르거나 상한을 넘을 때
  - `CLASS_ACCESS_DENIED` (403) — 담당 반이 아닐 때
  - `CLIENT_PHOTO_ID_CONFLICT` (409) — 같은 `client_photo_id`가 다른 반에 이미 있을 때
- [확인 필요: 김동건] 영상·음성 업로드가 끝난 뒤 서버 STT를 어디서 시작할지 정해야 합니다(동기 처리 vs Celery).

### `PUT /api/v1/media/{media_id}/child-links` — 교사가 확정한 귀속과 `llm_allowed`를 한 번에 저장

- 쓰는 화면: 얼굴 분류·결과 확인과 수동 분류/사진에서 정한 값을, 처리 중/서버 전송에서 보냅니다.
- 요구사항: FR-04, FR-14
- 권한: 교사 — 미디어가 속한 반이 담당 반일 때만. `child_id`도 같은 반 원아만 받습니다.
- 요청:
  - `llm_allowed`: 필수이고 기본값이 없습니다. 얼굴 분류 · 결과 확인 화면의 확인 체크에서 옵니다.
  - `child_links[]`: 각 항목은 `child_id`, `method`, `confidence_score`입니다. `confidence_score`는 `face_recognition`일 때만 채우고, `manual`이면 null입니다.
  - 사진·영상·음성메모 모두 이 엔드포인트로 보냅니다(제안). 영상·음성메모는 `method: "manual"`로 원아를 여러 명 넣을 수 있습니다. 음성메모도 귀속돼 있어야 근거 수집 함수 `collect_media_for_llm(child_id, …)`가 찾아냅니다.
  - 빈 배열을 보내면 서버에 미분류로 남습니다.
  - 전체 교체 방식입니다(임시 결정(김동건)). 보낸 목록이 최종 상태이고, 목록에 없는 기존 링크는 지웁니다. 같은 본문을 다시 보내도 결과가 같습니다. 검사에 걸리면 기존 링크를 그대로 둡니다.

```json
{
  "llm_allowed": true,
  "child_links": [
    { "child_id": "c41d0000-0000-4000-8000-000000000001", "method": "face_recognition", "confidence_score": 0.92 },
    { "child_id": "c41d0000-0000-4000-8000-000000000002", "method": "manual", "confidence_score": null }
  ]
}
```

음성메모 예: `{ "llm_allowed": true, "child_links": [{ "child_id": "c41d0000-0000-4000-8000-000000000001", "method": "manual", "confidence_score": null }] }`

- 응답 `200`:

```json
{
  "media_id": "3ed1a000-0000-4000-8000-000000000041",
  "llm_allowed": true,
  "child_links": [
    { "child_id": "c41d0000-0000-4000-8000-000000000001", "method": "face_recognition", "confidence_score": 0.92 },
    { "child_id": "c41d0000-0000-4000-8000-000000000002", "method": "manual", "confidence_score": null }
  ],
  "attributed_at": "2026-09-15T06:02:10Z"
}
```

- `llm_allowed`는 서버에 저장된 최종값입니다.
- `attributed_at`(제안)은 귀속을 한 번이라도 저장하면 채웁니다. 빈 목록이어도 채웁니다. agents는 Job을 만들 때 이 값을 확인합니다.
- 에러:
  - `MEDIA_ASSET_NOT_FOUND` (404) — 없는 `media_id`일 때
  - `INVALID_ATTRIBUTION_METHOD` (400) — `method`가 두 값 밖이거나, `manual`인데 점수가 있거나 `face_recognition`인데 점수가 없을 때
  - `DUPLICATE_CHILD_LINK` (400) — 같은 `child_id`가 목록에 두 번 있을 때
  - `CHILD_NOT_IN_CLASS` (400) — 미디어가 속한 반의 원아가 아닐 때
  - `CLASS_ACCESS_DENIED` (403) — 담당 반이 아닐 때
- [확인 필요: 김동건·정은] `llm_allowed` 최종값을 누가 계산할지 정해야 합니다. 제안은 두 가지입니다.
  - 사진: 서버가 "교사 확인 AND 귀속 원아 전원 ③ 동의"로 계산해 저장합니다.
  - 영상·음성메모: 교사 확인값을 그대로 저장합니다.
- [확인 필요: 김동건·정은] 영상·음성메모도 이 엔드포인트로 수동 귀속하는 위 제안을 채택할지 정해야 합니다.

### `GET /api/v1/media/{media_id}` — 만료된 근거 미디어의 서명 URL(presigned GET) 재발급

- 쓰는 화면: 초안 검토/왼쪽 원아 목록 — "▶ 00:18부터 듣기"와 선택 사진
- 요구사항: FR-07
- 권한: 교사 — 담당 반의 미디어만
- 요청: 경로 `media_id`. 첫 URL은 documents `GET /api/v1/drafts/{draft_id}` 응답의 `media[]`에 담겨 옵니다. `url_expires_at`이 지나면 이 엔드포인트로 다시 받습니다.
- 응답 `200`:

```json
{
  "media_id": "3ed1a000-0000-4000-8000-000000000044",
  "type": "voice_memo",
  "captured_at": "2026-09-15T01:24:00Z",
  "url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Expires=300&X-Amz-Signature=…",
  "url_expires_at": "2026-09-15T07:05:00Z"
}
```

- `storage_url`, `teacher_id`, `model_version`은 싣지 않습니다.
- 에러:
  - `MEDIA_ASSET_NOT_FOUND` (404) — 없는 `media_id`일 때
  - `CLASS_ACCESS_DENIED` (403) — 담당 반의 미디어가 아닐 때
  - `MEDIA_DELETED` (409) — 이미 파기됐을 때(`storage_tier = deleted`)
- [확인 필요: 김동건] 서명 URL 만료 시간(예시 5분)을 정해야 합니다. 파생본이 없어서 HEIC·MOV는 사파리가 아닌 브라우저에서 보이지 않을 수 있습니다. 데모 자료를 JPG·MP4로 제한할지도 정해야 합니다.
- [확인 필요: 한상균] URL 발급을 AccessLog에 남길지, 남긴다면 `target_type`·`action` 값을 무엇으로 할지 정해야 합니다.

### `GET /api/v1/classes/{class_id}/face-embeddings` — 반 동의 원아의 기준 임베딩 캐시(온디바이스 분류용)

- 쓰는 화면: 처리 중/온디바이스 분류 — 분류를 시작할 때 한 번 부릅니다.
- 요구사항: FR-04
- 권한: 교사 — 담당 반만
- 요청: 경로 `class_id`
- 응답 `200`:

```json
{
  "items": [
    { "child_id": "c41d0000-0000-4000-8000-000000000001", "embedding": [0.0213, -0.0871, 0.0456], "model_version": "buffalo_l-1.0" },
    { "child_id": "c41d0000-0000-4000-8000-000000000002", "embedding": [-0.0342, 0.0617, 0.0129], "model_version": "buffalo_l-1.0" }
  ],
  "next_cursor": null
}
```

- ③ 동의가 유효한 재원 원아 가운데 임베딩이 등록된 원아만 담습니다. 동의 기록과 임베딩이 어긋나면 그 원아는 빼습니다.
- 벡터만 내보냅니다(H-3). `embedding`은 ArcFace float 512개이고, 예시는 줄였습니다.
- `model_version`이 브라우저 모델과 다르면 그 원아는 수동 분류로 보냅니다(제안). 지금 `load_embedding_cache`는 벡터만 돌려주므로, `model_version`도 돌려주도록 service를 고쳐야 합니다.
- 응답에 `Cache-Control: no-store`를 붙입니다(제안). 브라우저는 이번 배치 동안만 들고 있다가 버립니다.
- 호출할 때마다 원아별로 AccessLog를 남깁니다. 벡터 값은 로그에 남기지 않습니다(H-4).
- `items`가 비면 모든 사진이 수동 분류로 갑니다.
- 에러:
  - `CLASS_ACCESS_DENIED` (403) — 담당 반이 아닐 때
  - `CLASS_NOT_FOUND` (404) — 없는 반일 때
  - `FACE_EMBEDDING_DECRYPTION_FAILED` (500) — 저장된 임베딩을 복호화하지 못했을 때
  - `FACE_EMBEDDING_KEY_NOT_CONFIGURED` (500) — 서버 키 설정이 빠졌을 때
  - 어떤 에러든 FE는 분류를 멈춥니다. 빈 목록으로 대신하지 않습니다.
- [확인 필요: 이한나] `get_consented_children`(이슈 #31, OPEN)을 제공해 주셔야 합니다. 그전까지는 MSW로만 개발합니다.

### `PUT /api/v1/children/{child_id}/face-embedding` — 얼굴 정보 등록·갱신(브라우저가 뽑은 벡터만 저장)

> 임시 결정(김동건): 경로만이던 것을 얼굴 정보 등록 화면을 만들며 채웠습니다. FE 목·타입과 같은 모양입니다(`types/api-draft/face.ts`).

- 쓰는 화면: 얼굴 정보 등록 — "얼굴 정보 등록 · 갱신"
- 요구사항: FR-04, H-3
- 권한: 교사 — 담당 반의 원아만
- 요청: 등록 사진 1~3장에서 브라우저가 뽑은 벡터 하나와 모델 버전입니다. **사진 원본은 보내지 않습니다**(H-3). 사진은 벡터를 뽑은 뒤 브라우저에서 버립니다.

```json
{
  "embedding": [0.0213, -0.0871, 0.0456],
  "model_version": "buffalo_l-1.0"
}
```

- 응답 `200`: 이미 있으면 덮어씁니다(원아당 한 개). 벡터는 돌려주지 않습니다.

```json
{
  "child_id": "c41d0000-0000-4000-8000-000000000001",
  "model_version": "buffalo_l-1.0",
  "registered_at": "2026-09-29T06:10:00Z"
}
```

- `embedding` 길이·`model_version` 값은 예시입니다. 온디바이스 모델이 정해지지 않아(09/28, 이번 주는 목) FE 목은 짧은 합성 벡터와 `"mock"`을 씁니다.
- 벡터 값은 로그에 남기지 않습니다(H-4).
- 에러:
  - `CHILD_NOT_FOUND` (404) — 없는 원아일 때
  - `CHILD_ACCESS_DENIED` (403) — 담당 반의 원아가 아닐 때
  - 422 — `embedding`이 비었거나 숫자 배열이 아닐 때(공통 검증 오류)
- ③ 동의가 없는 원아의 등록을 어떻게 막을지는 하단 §상의 필요 4에 있습니다.

### `DELETE /api/v1/children/{child_id}/face-embedding` — 얼굴 정보 삭제

> 임시 결정(김동건): 경로만이던 것을 얼굴 정보 삭제 확인 화면을 만들며 채웠습니다.

- 쓰는 화면: 얼굴 정보 삭제 확인 — "얼굴 정보 삭제"
- 요구사항: FR-22, H-4
- 권한: 교사 — 담당 반의 원아만
- 요청: 경로 `child_id`. 본문 없음
- 응답 `204`. 등록된 얼굴 정보가 없어도 `204`입니다(같은 요청을 다시 보내도 결과가 같음).
- 파기는 `DeletionLog`에 남깁니다(H-4). 사유·대상 코드는 하단 §상의 필요 4에 있습니다.
- 삭제 뒤 그 원아는 `GET /classes/{class_id}/face-embeddings`에서 빠지고, 다음 분류부터 수동 분류로 갑니다.
- 에러:
  - `CHILD_NOT_FOUND` (404) — 없는 원아일 때
  - `CHILD_ACCESS_DENIED` (403) — 담당 반의 원아가 아닐 때

## 경로만 정한 엔드포인트

경로만 정했습니다. 요청·응답은 그 화면을 만들 때 이 파일에 먼저 채웁니다(PR). 어느 화면이 쓰는지는 [screens.md](screens.md)에 있습니다. "확장(경로만)"은 위 상세 작성 엔드포인트에 필드나 파라미터를 더하는 것입니다.

| 메서드·경로 | 하는 일 | 단계 | BE 담당 |
|---|---|---|---|
| `GET /api/v1/media/{media_id}/transcript-segments` | 영상·음성의 발화 구간. ④ 얼굴 분류·수동 분류는 업로드 전 화면이라 쓰지 않음(발화는 업로드 뒤 서버 STT가 만듦) | 경로만 | 김동건 |
| `PATCH /api/v1/transcript-segments/{segment_id}` | 발화 구간 고치기. 쓰는 화면이 정해지지 않음(수동 분류/발화 화면 숨김) | 경로만 | 김동건 |
| `GET /api/v1/classes/{class_id}/media?record_date=` | 반·날짜별 미디어 목록(홈·앨범용, 지금 화면 없음) | 경로만 | 김동건 |
| `POST /api/v1/media/multipart-uploads` | 큰 파일 나눠 올리기 | 경로만 | 김동건 |

---

## 상의 필요 — 김동건 제안

> 다른 담당과 경계에 걸려 있어 혼자 정하지 않은 것입니다. 위 본문은 바꾸지 않았고, 합의되면 본문에 옮깁니다. 팀 결정이 아닙니다.

### 1. 업로드 흐름 줄이기 (정은·송유진과 함께)

지금 본문은 파일마다 `POST /media`(ack) → `PUT /media/{media_id}/child-links` 두 번을 부릅니다. 150장이면 URL 발급을 빼고도 300번입니다. 아래처럼 바꾸자고 제안합니다.

- **`POST /media/upload-urls`는 한 번에 10개씩, 결과는 건별로.** 한 건이 틀려도 전체를 거절하지 않고 `items[].status`(`ok` / `error`)와 `items[].code`(예: `MEDIA_TYPE_NOT_ALLOWED`)로 알려 줍니다. 브라우저 사전 형식 검사(#58 정은 제안)는 그대로 하고, 서버도 다시 검사합니다.
- **완료 통지(`POST /media`)에 `child_links`·`llm_allowed`를 함께 싣고 `PUT /media/{media_id}/child-links`는 없앱니다.** 귀속은 업로드 전 로컬에서 확정되고 서버에서 바뀌지 않습니다(테크스펙 파이프라인 2단계, `UnclassifiedItem`은 서버 도달 뒤 사유만). 전체 교체 규칙(본문 child-links 절)은 완료 통지에 그대로 옮깁니다. 같은 `client_photo_id`를 다시 보내면 기존 `media_id`를 `200`으로 돌려주는 규칙도 그대로입니다.
- 바뀌면 같이 고칠 곳: 정은 님 `SendStep`(서버 전송), 송유진 님 media 목(`mocks/handlers/media.ts`), 테크스펙 흐름 표 C의 "마지막 **귀속 저장**이 끝나면 `POST /jobs`" → "마지막 **완료 통지(ack)**를 받으면"(#61), agents.md `MEDIA_NOT_READY`의 `attributed_at` 조건.

### 2. 영상·음성메모 귀속 (정은과 함께, 테크스펙 변경 필요)

- **영상**: 사진처럼 교사가 아이를 고릅니다(`method: "manual"`, 여러 명 가능). LLM 허용은 사진과 같은 확인 체크를 따릅니다.
- **음성메모**: 귀속을 붙일 예정이지만, AI 쪽에서 음성 근거를 어떻게 쓸지 결론이 나지 않았습니다. 정해지기 전까지 빈 귀속(`child_links: []`, 서버에 미분류)으로 올립니다.
- 충돌: 테크스펙 데이터 모델 ⑧(09/14)과 `frontend/CLAUDE.md` §온디바이스는 "영상·음성메모는 로컬 분류·검수 없이 업로드 큐만"입니다. 영상 수동 귀속을 하려면 테크스펙을 먼저 고쳐야 합니다. 지금 FE 코드(업로드 큐, 수동 분류)는 테크스펙대로 사진만 검수합니다.

### 3. `llm_allowed`와 동의 철회 (정은과 함께)

- 제안 (b): 동의를 철회한 원아의 사진은 저장된 `llm_allowed`를 덮어쓰지 않고, `collect_media_for_llm`(#34)이 근거를 모을 때마다 귀속 원아 **전원**의 ③ 동의를 다시 확인해 한 명이라도 유효하지 않으면 뺍니다. 철회 처리가 중간에 실패해도 사진이 새지 않고, 재동의하면 되살아납니다.
- 남은 것: 저장할 `llm_allowed`를 서버가 계산할지(본문 [확인 필요: 김동건·정은]).

### 4. 얼굴 정보 등록의 동의 확인과 파기 기록 (이한나·한상균과 함께)

- 등록 전 ③ 동의 확인: 동의 판정은 organization이 맡습니다(`get_consented_children`, #31). 미동의 원아의 등록을 막을 에러 코드와, 화면의 동의·등록 상태를 받을 `GET /children/{child_id}` 확장 필드(organization 경로만)가 필요합니다. 동의 주체는 학부모(앱)로 바뀌었습니다(#39, FR-28).
- 삭제의 `DeletionLog` 사유·대상 코드: #74에서 확인 중입니다.
- 얼굴 정보 삭제 확인 화면의 "동의 철회"(`POST /children/{child_id}/consents/revoke`)를 교사도 부를 수 있는지는 FR-22 철회 주체 질문(`docs/open-questions.md`)과 같습니다.

### 5. 재생 URL 서명 함수 (한상균과 함께)

- documents용 `get_playback_url`(한 건씩, 서명·만료 없음)을 `get_signed_urls(media_ids)`로 바꾸고 `{media_id, type, url, url_expires_at}`를 돌려주자고 제안합니다. 비공개 S3에서는 서명 없는 URL을 쓸 수 없습니다. #32에서 `get_playback_url`을 안내했으므로 바뀌면 다시 알립니다.
- 만료: 업로드 PUT은 짧게, 재생 GET은 길게. 영상은 재생 중 Range 요청을 계속 보내므로 만료가 짧으면 중간에 끊깁니다. 값은 미정입니다.
