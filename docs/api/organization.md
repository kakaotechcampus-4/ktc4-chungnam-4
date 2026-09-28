# organization API — 반·원아·학부모 자녀

> 담당 이한나

> 표기(상세 작성·경로만·`(제안)`·`[확인 필요]`)와 어느 문서가 원본인지는 [README](README.md)에 있습니다. 공통 규약은 테크스펙 §공통 API 규약과 README §공통 규약 중 테크스펙에 없는 것에 있습니다.

## 정해 주셔야 할 것

(막힘)은 정해져야 FE 목(MSW)과 BE schemas를 만들 수 있는 항목입니다. 막히면 작업하는 사람이 정하고 진행합니다. 정한 값은 같은 PR에서 이 파일에 반영하고, 항목을 `[x]`로 바꾼 뒤 `임시 결정(이름)`과 반영한 곳을 적습니다([README](README.md) §이 문서를 읽는 법). 담당의 답은 이슈 #58 댓글이나 이 파일을 고치는 PR로 받습니다.

- [ ] (막힘) `get_consented_children` 구현(이슈 #31). face 임베딩 캐시와 `llm_allowed` 판정이 이 함수를 기다림
- [ ] `age_group` 값 형식("만 4세" vs "만 3~5세"), 코드와 표시 라벨을 나눌지
- [ ] 필수 동의 ①② 기록이 없는 원아를 명단에서 뺄지(김동건과 함께)
- [ ] NFR-03 만료 자녀를 `access_expired: true`로 남기는 안
- [ ] `class_teacher_name` 조인 방식(`Class.teacher_id` → auth의 `Teacher.name`)
- [ ] 학부모 게이트용 `is_parent_of`(가칭)와 `graduated_at` 조회 함수 제공
- [ ] 이름만 표시하려고 `given_name`을 둘지(이 문서에서는 FE가 성을 뗌)
- [ ] 경로만 정한 동의 API 대비: ConsentRecord.status 값, `consent_type` 코드(`personal_info`·`activity_media`·`face_feature` 제안)
- [ ] 09-22 결정(PR #39) 반영: 학부모가 원아별 초대 링크로 가입하며 직접 동의함(FR-28, 교사의 동의 등록 FR-01은 폐기). 동의 확인 모달의 `POST /api/v1/children/{child_id}/consents`를 초대 수락으로 옮길지, 철회(FR-22)를 학부모도 할지(엄태은과 함께)
- [ ] develop(PR #14)의 학부모 알림장 API는 `child_id` 없이 로그인한 학부모 기준이라, W3 자녀 칩 전환과 `access_expired` 자녀의 `CHILD_ACCESS_EXPIRED` 차단을 어떻게 할지(한상균과 함께)
- [ ] `organization/CLAUDE.md`의 `/organization` 표기 수정

## 이 도메인의 규칙

organization의 상세 작성 엔드포인트는 읽기 전용 3개입니다. 교사의 담당 반 목록, 반 원아 명단, 학부모의 자녀 목록입니다. 반·원아·동의를 만들거나 바꾸는 엔드포인트는 모두 경로만 정했습니다.

## 상세 작성 엔드포인트

### `GET /api/v1/classes` — 교사의 담당 반 목록(헤더의 어린이집명·반 선택)

- 쓰는 화면:
  - 교사 공통 헤더와 부제의 "· 햇살반": 오늘의 기록·빈 상태를 비롯한 상세 작성 범위의 교사 화면 전체
  - 로그인 직후 들어갈 반을 고를 때
- 요구사항: FR-25
- 권한: 교사 — `Class.teacher_id`가 본인인 반만
- 요청: 파라미터 없음. 반 이름 가나다순입니다(제안).
- 응답 `200`:

```json
{
  "items": [
    {
      "class_id": "c1a50000-0000-4000-8000-000000000001",
      "center_id": "0c000000-0000-4000-8000-000000000001",
      "center_name": "햇살어린이집",
      "name": "햇살반",
      "age_group": "만 4세"
    }
  ],
  "next_cursor": null
}
```

- `center_name`(제안)은 헤더에 쓰려고 `Center.name`을 붙인 값입니다.
- 담당 반이 없으면 `items: []`입니다. FE는 이 경우 온보딩으로 보냅니다. 온보딩 API는 경로만 정했습니다.
- 에러: 공통 에러만
- [확인 필요: 이한나] `age_group` 값 형식을 정해야 합니다. Figma에는 "만 4세"(오늘의 기록 · 업로드 중)와 "만 0~2세 / 만 3~5세"(반 만들기)가 섞여 있습니다. 에이전트 도구가 이 값을 보고 교육과정을 고릅니다.
- [확인 필요: 이한나·엄태은] 원장이 어린이집의 모든 반을 볼 수 있는지 정해야 합니다. 이 문서에서는 담당 반만 돌려주도록 정했습니다.

### `GET /api/v1/classes/{class_id}/children` — 반의 재원 원아 명단(교사 화면 원아 이름의 유일한 출처)

- 쓰는 화면:
  - 오늘의 기록·업로드 중: "· 5명"
  - 처리 중/온디바이스 분류: 이름 매핑
  - 얼굴 분류·결과 확인: "전체 5명"
  - 수동 분류/사진: 원아 선택지
  - 초안 검토/왼쪽 원아 목록: 레일
  - 승인 확인 모달: 원아 이름
  - 알림장 올리기: "전체 5명"
- 요구사항: FR-04, FR-14
- 권한: 교사 — 담당 반만
- 요청: 경로 `class_id`. 재원 원아만 이름 가나다순으로 돌려줍니다(제안). 이름 검색은 FE에서 합니다.
- 응답 `200`:

```json
{
  "items": [
    { "child_id": "c41d0000-0000-4000-8000-000000000001", "class_id": "c1a50000-0000-4000-8000-000000000001", "name": "김도윤" },
    { "child_id": "c41d0000-0000-4000-8000-000000000003", "class_id": "c1a50000-0000-4000-8000-000000000001", "name": "박서아" },
    { "child_id": "c41d0000-0000-4000-8000-000000000002", "class_id": "c1a50000-0000-4000-8000-000000000001", "name": "이하준" },
    { "child_id": "c41d0000-0000-4000-8000-000000000005", "class_id": "c1a50000-0000-4000-8000-000000000001", "name": "정예린" },
    { "child_id": "c41d0000-0000-4000-8000-000000000004", "class_id": "c1a50000-0000-4000-8000-000000000001", "name": "최지우" }
  ],
  "next_cursor": null
}
```

- ③ 미동의 원아도 명단에 넣습니다. 업로드와 수동 분류를 막지 않습니다(H-3).
- 동의, 얼굴 등록, 보호자 연결 상태는 상세 작성 범위의 화면 17개 어디에도 나오지 않아 뺐습니다. 이 필드들을 추가하는 확장(경로만)은 아래 "경로만 정한 엔드포인트" 표에 있습니다. LLM 제외 대상과 얼굴 대조 대상은 서버가 `get_consented_children`으로 판정합니다.
- 이니셜은 FE가 이름에서 만듭니다.
- 에러:
  - `CLASS_ACCESS_DENIED` (403) — 담당 반이 아님
  - `CLASS_NOT_FOUND` (404) — 없는 반
- [확인 필요: 이한나·김동건] 필수 동의 ①② 기록이 없는 원아를 명단(분류 선택지)에서 뺄지 정해야 합니다.

### `GET /api/v1/me/children` — 학부모용 자녀 목록(W3·W4 상단 자녀 표시)

- 쓰는 화면:
  - 학부모 W3 알림장 목록: 자녀 칩, 반·어린이집·담임 줄, "다른 아이 보기"
  - 학부모 W4 알림장 본문: 상단 자녀 칩
- 요구사항: FR-09
- 권한: 학부모 — ParentChildRelation으로 연결된 자녀만
- 요청: 파라미터 없음
- 응답 `200`:

```json
{
  "items": [
    {
      "child_id": "c41d0000-0000-4000-8000-000000000001",
      "name": "김도윤",
      "class_id": "c1a50000-0000-4000-8000-000000000001",
      "class_name": "햇살반",
      "age_group": "만 4세",
      "center_name": "햇살어린이집",
      "class_teacher_name": "김하늘",
      "access_expired": false
    }
  ],
  "next_cursor": null
}
```

- 교사용 명단과 스키마를 나눕니다(H-1과 같은 원칙). 동의 상태와 다른 보호자 정보는 싣지 않습니다.
- `class_teacher_name`(제안)은 현재 담임입니다(`Class.teacher_id` → `Teacher.name`). 알림장 작성자 `author_name`과는 다른 값입니다.
- `access_expired`(제안)는 졸업 후 1년이 지나면 `true`입니다(NFR-03). 목록에서 빼지 않고 표시만 합니다. 이 자녀의 알림장 조회는 `CHILD_ACCESS_EXPIRED`로 막힙니다.
- 연결된 자녀가 없으면 `items: []`입니다. FE는 빈 화면을 보여 줍니다(데이터 모델 "매칭 실패 시 빈 화면").
- "도윤이의 알림장"처럼 이름만 쓰는 곳은 FE 유틸이 성을 떼어 만듭니다.
- 에러: 공통 에러만
- [확인 필요: 엄태은·이한나] 이 경로는 auth가 쓰는 `/me` 아래에 있지만 organization 라우터가 맡습니다. 두 사람이 이 방식을 받아들일지 정해야 합니다.
- [확인 필요: 이한나] `class_teacher_name`은 auth의 Teacher 테이블과 조인해야 합니다. 어떤 service 함수로 받을지 정해야 합니다.

**엔드포인트는 아니지만 상세 작성 범위의 흐름이 기대는 service 함수**

- `get_consented_children(db, class_id, consent_type) -> list[UUID]`: 이슈 #31(OPEN, 담당 이한나)로 요청돼 있고 아직 구현 전입니다. face 임베딩 캐시와 LLM 제외 판정이 이 함수를 씁니다.
- `is_parent_of(db, parent_id, child_id) -> bool`(가칭): documents의 학부모 노출 게이트(H-1)가 씁니다. NFR-03 만료 판정도 이 함수에서 합니다(제안).

## 경로만 정한 엔드포인트

경로만 정했습니다. 요청·응답은 그 화면을 만들 때 이 파일에 먼저 채웁니다(PR). 어느 화면이 쓰는지는 [screens.md](screens.md)에 있습니다. "확장(경로만)"은 위 상세 작성 엔드포인트에 필드나 파라미터를 더하는 것입니다.

| 메서드·경로 | 하는 일 | 단계 | BE 담당 |
|---|---|---|---|
| `GET /api/v1/centers?center_code=` | 가입 코드로 어린이집 찾기 | 경로만 | 이한나 |
| `POST /api/v1/centers` | 어린이집 새로 등록 | 경로만 | 이한나 |
| `GET /api/v1/centers/{center_id}/classes` | 어린이집의 반 목록(반 고르기) | 경로만 | 이한나 |
| `POST /api/v1/classes` | 반 만들기 | 경로만 | 이한나 |
| `POST /api/v1/classes/{class_id}/assign` | 그 반의 담임으로 배정 | 경로만 | 이한나 |
| `POST /api/v1/classes/{class_id}/children` | 원아 등록 | 경로만 | 이한나 |
| `PATCH /api/v1/children/{child_id}` | 원아 정보 수정 | 경로만 | 이한나 |
| `GET /api/v1/classes/{class_id}/children` | `?status=`, 동의·얼굴 등록(`is_face_registered`)·보호자 연결 필드 추가 | 확장(경로만) | 이한나 |
| `GET /api/v1/children/{child_id}` | 원아 한 명 상세 | 경로만 | 이한나 |
| `GET /api/v1/children/{child_id}/consents` | 원아의 동의 현황 | 경로만 | 이한나 |
| `POST /api/v1/children/{child_id}/consents` | 동의 결과 기록 | 경로만 | 이한나 |
| `POST /api/v1/children/{child_id}/consents/revoke` | 동의 철회 | 경로만 | 이한나(임베딩 삭제는 김동건) |
| `GET /api/v1/me/children` | 그대로 W5 자녀 전환에도 씁니다 | 확장(경로만) | 이한나 |
| `GET /api/v1/classes/{class_id}/education-plans` | 반의 교육 계획 목록 | 경로만 | 이한나 |
| `POST /api/v1/classes/{class_id}/education-plans` | 교육 계획 만들기 | 경로만 | 이한나 |
| `PATCH /api/v1/education-plans/{plan_id}` | 교육 계획 수정 | 경로만 | 이한나 |
| `POST /api/v1/children/{child_id}/parent-invites` | 학부모 초대 링크 만들기 | 경로만 | 이한나·엄태은 |
| `GET /api/v1/parent-invites/{token}` | 초대 링크 열기(아이·반·어린이집 정보) | 경로만 | 이한나·엄태은 |
| `POST /api/v1/parent-invites/{token}/accept` | 초대를 받아 학부모 계정을 만들고 자녀와 잇기 | 경로만 | 이한나·엄태은 |
