# 화면별 API

> 화면마다 어떤 API를 쓰는지 모았습니다. 단계 표기(상세 작성·경로만)는 [README](README.md)를 따르고, 경로만 정한 API의 세부는 그 화면을 만들 때 해당 도메인 파일에 먼저 채웁니다.

> 표의 경로는 앞의 `/api/v1`을 뺐습니다. 화면 이름과 담당은 FE 담당별 화면 분담(Figma)의 확정 화면을 따르고, 도메인별 엔드포인트는 각 도메인 파일에 있습니다.

- 확정 화면을 담당 순서대로 한 줄씩 적었습니다. 후보 A는 따로 세지 않습니다.
- 교사 화면의 공통 헤더(선생님 이름, 어린이집·반)는 레이아웃이 `GET /me`, `GET /classes`로 그리므로 표에서 뺐습니다.
- 모달·드롭다운은 그 화면을 띄운 화면의 호출을 같이 씁니다. 표에는 그 화면에서 더 부르는 것만 적었습니다.
- 단계: 상세 작성 / 경로만 / 둘 다(상세 작성과 경로만을 함께 씀) / 제안(도메인 파일 하단 §상의 필요에만 있음) / API 없음(브라우저 안에서 끝남) / API 없음(정적)

| 담당 | 화면 | 쓰는 API | 단계 |
|---|---|---|---|
| ① 송유진 | 홈페이지 · 첫 방문 | 소개와 로그인·시작 버튼뿐 | API 없음(정적) |
| ① 송유진 | 로그인 | `POST /sessions`, `GET /me`, `GET /classes`(로그인 직후 들어갈 반 고르기), `POST /sessions`에 `remember_me`(확장(경로만), 후보 A를 고르면) | 둘 다 |
| ① 송유진 | 회원가입 | `POST /accounts` | 경로만 |
| ① 송유진 | 비밀번호 찾기 | `POST /password-resets` | 경로만 |
| ① 송유진 | 계정 · 설정 | `GET /me`, `PATCH /me`(수정), `DELETE /sessions/current`(로그아웃), (목록에 없음: 알림 설정 3개 읽기·저장) | 둘 다 |
| ① 송유진 | 접근 권한 없음 | `GET /me`(내 홈으로 돌아가기), `DELETE /sessions/current`(다른 계정으로 로그인) | 상세 작성 |
| ① 송유진 | W1 초대 링크 열기 | `GET /parent-invites/{token}` | 경로만 |
| ① 송유진 | W2 계정 만들기 | `POST /parent-invites/{token}/accept` | 경로만 |
| ① 송유진 | W3 알림장 목록 | `GET /me`, `GET /me/children`, `GET /children/{child_id}/parent-notes` | 상세 작성 |
| ① 송유진 | W4 알림장 본문 | `GET /parent-notes/{parent_note_id}`, `GET /me`(상단 계정 표시), `GET /me/children`(상단 자녀 칩) | 상세 작성 |
| ① 송유진 | W5 자녀 전환 | W3 알림장 목록의 호출 그대로, `GET /me/children`(확장(경로만), 그대로 재사용), 다른 아이 초대 코드 등록은 `POST /parent-invites/{token}/accept` | 둘 다 |
| ② 이한나 | 교사 정보 입력 | `GET /centers?center_code=`(코드 확인), `POST /centers`(코드가 없을 때), `POST /accounts`(가입 완료하기) | 경로만 |
| ② 이한나 | 반 만들기 | `POST /classes` | 경로만 |
| ② 이한나 | 반 선택 · 추가 | `GET /centers/{center_id}/classes`, `POST /classes/{class_id}/assign`, `GET /me`에 `onboarding_step`(확장(경로만)) | 경로만 |
| ② 이한나 | 원아 등록 · 동의와 얼굴 정보 | `GET /classes/{class_id}/children`에 동의·얼굴 등록 필드(확장(경로만)) | 경로만 |
| ② 이한나 | 동의 확인 모달 | 원아 등록 · 동의와 얼굴 정보의 호출 그대로, `GET /children/{child_id}/consents`, `POST /children/{child_id}/consents`, `POST /children/{child_id}/consents/revoke` | 경로만 |
| ② 이한나 | 원아 명단 관리 | `GET /classes/{class_id}/children`에 `?status=`·동의·얼굴·보호자 연결 필드(확장(경로만)), `POST /classes/{class_id}/children` | 경로만 |
| ② 이한나 | 원아 추가 · 수정 | `POST /classes/{class_id}/children`(추가), `GET /children/{child_id}`, `PATCH /children/{child_id}`(수정) | 경로만 |
| ② 이한나 | 학부모 초대 링크 | `GET /children/{child_id}`(이름·연결 상태), `POST /children/{child_id}/parent-invites`(링크 다시 만들기), `GET /children/{child_id}/parent-invites`(지금 쓰는 링크, 복사용. 임시 결정(이한나)) | 경로만 |
| ② 이한나 | 원아 개인 페이지 | `GET /children/{child_id}`, `GET /children/{child_id}/drafts?doc_type=parent_note`(알림장 목록, 관찰일지 목록과 같은 경로), (목록에 없음: 이번 달 기록 수와 누리과정 5영역별 수) | 경로만 |
| ② 이한나 | 교육 계획 · 빈 상태 | `GET /classes/{class_id}/education-plans`(0건) | 경로만 |
| ② 이한나 | 교육 계획 · 작성 | `POST /classes/{class_id}/education-plans`, `PATCH /education-plans/{plan_id}`(수정) | 경로만 |
| ② 이한나 | 교육 계획 · 목록 | `GET /classes/{class_id}/education-plans` | 경로만 |
| ③ 정은 | 오늘의 기록 · 빈 상태 | `GET /classes/{class_id}/drafts?record_date=`(오늘 초안이 있으면 검토로), `GET /classes/{class_id}/jobs?record_date=`(하던 작업으로 돌아가기) | 둘 다 |
| ③ 정은 | 자료 올리기 | 파일을 IndexedDB에 쌓기만 함 | API 없음(브라우저 안에서 끝남) |
| ③ 정은 | 오늘의 기록 · 업로드 중 | `GET /classes/{class_id}/children`("· 5명") | 상세 작성 |
| ③ 정은 | 업로드 실패 · 재시도 | 다시 시도는 서버 전송과 같은 `POST /media/upload-urls` → S3 `PUT` → `POST /media`, 큰 파일은 `POST /media/multipart-uploads`. 형식 오류는 브라우저에서 먼저 거름(제안. `upload-urls`는 한 건만 틀려도 요청 전체를 거절함) | 둘 다 |
| ③ 정은 | 처리 중 / 모델 다운로드 | 정적 모델 파일만 받음 | API 없음(정적) |
| ③ 정은 | 처리 중 / 온디바이스 분류 | `GET /classes/{class_id}/face-embeddings`, `GET /classes/{class_id}/children`(이름 매핑) | 상세 작성 |
| ③ 정은 | 처리 중 / 서버 전송 | `POST /media/upload-urls`, S3 `PUT`, `POST /media`, `PUT /media/{media_id}/child-links`, 끝나면 `POST /classes/{class_id}/jobs`, 경로만 정한 API로는 `POST /media/multipart-uploads`(큰 파일)·`POST /jobs/{job_id}/cancel`(취소) | 둘 다 |
| ③ 정은 | 처리 중 / 초안 생성 | `GET /jobs/{job_id}`(2초 폴링), `POST /jobs/{job_id}/cancel`(취소) | 둘 다 |
| ③ 정은 | 처리 실패 · 단계 재시도 | `GET /jobs/{job_id}`(실패한 단계), `POST /jobs/{job_id}/retry` | 둘 다 |
| ③ 정은 | 대시보드 | `GET /classes/{class_id}/drafts?record_date=`(승인 완료·검토 필요·생성 중·기록 전, 알림장 기준), `GET /classes/{class_id}/children`(명단, 동의·얼굴 필드는 확장(경로만)). "오늘의 기록 이어하기"는 jobs를 조회하지 않고 `/t/today`로 보내고, "기록하기"는 초안 검토 화면으로 보냄 — 임시 결정(정은) | 둘 다 |
| ④ 김동건 | 얼굴 분류 · 결과 확인 | `GET /classes/{class_id}/children`("전체 5명"), `GET /media/{media_id}/transcript-segments`("발화 N개", 상세 작성·임시 결정(김동건)), 추가 근거 표시는 `GET /classes/{class_id}/evidence?record_date=`(제안, agents.md 하단). 사진 분류는 브라우저 안에서, 영상·음성은 이 화면 전에 먼저 올림(제안, media-face.md 하단 §6). 사진 귀속과 `llm_allowed`(확인 체크)는 서버 전송 때 보냄 | 둘 다 |
| ④ 김동건 | 수동 분류 / 사진 | `GET /classes/{class_id}/children`(원아 선택지). 귀속은 서버 전송 때 보냄. 아이 카드의 사진을 눌러 아이를 바꾸는 화면(Figma 없음)도 같은 호출 | 상세 작성 |
| ④ 김동건 | 수동 분류 / 발화 | `GET /classes/{class_id}/children`, `GET /media/{media_id}/transcript-segments`, `PATCH /transcript-segments/{segment_id}`(아이 연결·화자·문장 수정·제외, 상세 작성·임시 결정(김동건)) | 상세 작성 |
| ④ 김동건 | 아이별 하루 확인(하루 정리 확인 + 추가 근거 작성) | 전송 전 자료로 그림: 이 기기의 사진, `GET /media/{media_id}/transcript-segments`·`PATCH /transcript-segments/{segment_id}`(발화 빼기), `GET /classes/{class_id}/evidence?record_date=`·`PUT /children/{child_id}/evidence/{record_date}`(추가 근거, 제안, agents.md 하단). "초안 만들기" 없음 — 전송은 분류 결과에서(#83 리뷰) | 둘 다 |
| ④ 김동건 | 얼굴 정보 등록 | `PUT /children/{child_id}/face-embedding`(상세 작성, 임시 결정(김동건)), `GET /children/{child_id}`(동의·등록 상태, 경로만) | 둘 다 |
| ④ 김동건 | 얼굴 정보 삭제 확인 | 얼굴 정보 등록의 호출 그대로, `DELETE /children/{child_id}/face-embedding`(상세 작성, 임시 결정(김동건)), `POST /children/{child_id}/consents/revoke`(동의 철회, 경로만) | 둘 다 |
| ⑤ 김진하 | 초안 검토 / 왼쪽 원아 목록 | `GET /classes/{class_id}/children`·`GET /classes/{class_id}/drafts`(레일), `GET /drafts/{draft_id}`, `PATCH /drafts/{draft_id}`, `POST /children/{child_id}/drafts`(자료 없는 원아에게 직접 작성), `POST /drafts/{draft_id}/approve`, `POST /drafts/{draft_id}/reopen`(게시 전까지 다시 검토), `GET /media/{media_id}`(URL 만료 시), `POST /drafts/{draft_id}/revision-requests`(AI에게 다듬기 요청). "사진과 본문을 확인했어요" 체크가 `approve`의 `reviewed`로 들어감 — **별도 승인 확인 모달 없이 이 화면의 체크와 버튼으로 승인합니다**(임시 결정(김진하)) | 둘 다 |
| ⑤ 김진하 | 전체 게시 확인 모달 | 초안 검토 / 왼쪽 원아 목록의 호출 그대로, `POST /publications`(승인한 원아 중 교사가 뺀 아이를 제외하고 보냄), 학부모 알림 발송은 `POST /publications` 확장(경로만). **개편 전 "알림장 올리기" 화면을 대신합니다** — 게시는 반 전체·하루 한 번이라 별도 화면 없이 오버레이로 확인합니다(임시 결정(김진하), [documents.md](documents.md) §`POST /api/v1/publications`) | 둘 다 |
| ⑤ 김진하 | 알림장 발행 완료 | `POST /publications` 결과, `GET /classes/{class_id}/drafts`(미작성 원아 보기) | 상세 작성 |
| ⑤ 김진하 | 알림장 게시판 | `GET /classes/{class_id}/drafts?doc_type=parent_note&published=true`(확장(경로만)), `GET /classes/{class_id}/children`(미작성 카드) | 둘 다 |
| ⑤ 김진하 | 알림장 목록(원아별) | `GET /children/{child_id}/drafts?doc_type=parent_note&published=true`(최신순, `preview`), `GET /classes/{class_id}/children`(아이 이름). **Figma 없음** — 알림장 게시판에서 바로 상세로 보내면 ‹ › 로 한 칸씩만 움직일 수 있어 기록이 쌓이면 못 찾습니다(임시 결정(김진하), #89 리뷰) | 상세 작성 |
| ⑤ 김진하 | 알림장 상세 | `GET /drafts/{draft_id}`, `GET /drafts/{draft_id}/read-receipts`(보호자 확인 수), (목록에 없음: 게시한 알림장 수정) | 둘 다 |
| ⑤ 김진하 | 관찰일지 목록 | `GET /classes/{class_id}/children`, `GET /children/{child_id}/drafts?doc_type=observation_log`(원아마다), (목록에 없음: 반 전체 관찰일지를 기간으로 조회) | 둘 다 |
| ⑤ 김진하 | 관찰일지 | `GET /drafts/{draft_id}`, `PATCH /drafts/{draft_id}`(저장하기) | 상세 작성 |

## 목록에 없는 것

화면에는 필요한데 상세 작성 엔드포인트에도, 경로만 정한 엔드포인트에도 없는 것입니다. 괄호는 맡을 만한 도메인입니다. 해당 도메인 파일에 먼저 적고 이 화면을 만들어 주세요.

- **계정 · 설정**: 알림 설정 3개(초안 준비 완료 알림, 학부모 확인 알림, 주간 요약 메일)를 읽고 저장할 곳. `GET /me`·`PATCH /me`에 넣을지 정해야 합니다. (auth)
- **학부모 초대 링크**: 지금 쓰는 초대 링크 조회. "초대 링크 복사"에 필요합니다. 경로만 정한 API에는 만들기(`POST`)만 있습니다. (organization) → 임시 결정(이한나): `GET /children/{child_id}/parent-invites` 추가. 반영: organization.md §② 화면용으로 채운 엔드포인트
- **원아 개인 페이지**: 이번 달 기록 수와 누리과정 5영역별 기록 수. (documents)
- **추가 근거 작성**: 교사가 쓴 관찰 메모(연결할 아이, 활동 시각, 음성, 관련 사진)를 그날 근거로 저장. (agents 또는 media · face) → 글만 받는 모양으로 제안: agents.md 하단 §상의 필요 2
- **알림장 상세**: 게시한 알림장의 "수정하기". `reopen`은 게시 전까지만 적혀 있습니다. (documents)
- **관찰일지 목록**: 반 전체 관찰일지를 기간(이번 주·이번 달·전체)으로 한 번에 받는 목록. 경로만 정한 API에는 원아별 목록만 있습니다. (documents)

## 화면·디자인 쪽 확인 — 송유진

- [ ] 얼굴 분류 · 결과 확인 화면의 "발화 N개"와 "▶ 발화 01"을 상세 작성 범위에서 "음성 N개"로 바꾸기(음성메모 수동 귀속안과 함께)
- [ ] 얼굴 분류 · 결과 확인 화면의 확인 체크 하나로 `llm_allowed`를 정할지, "얼굴 가림" 문구(redacted 제거 결정과 충돌)
- [ ] 초안 검토 화면의 "선택 사진 3장 · 알록달록 블록 놀이"에서 캡션을 빼고 "선택 사진 3장"으로 줄이기
- [ ] W3의 "이번 달 12"를 유지할지(한상균과 함께)
- [ ] 로그인 화면을 학부모와 함께 쓸 때의 문구(로그인 후보 A는 교사 전용 문구)
- [ ] 디자인 빈 곳: 게시 부분 실패, 열람 기간 종료(`CHILD_ACCESS_EXPIRED`), 학부모용 접근 권한 없음, 교사 초안의 `title`과 제목 없는 W4
- [ ] 상세 작성 범위 밖이라 숨길 UI: 비밀번호 찾기·회원가입, "+ 추가 근거 작성", "AI에게 다듬기 요청", "학부모 알림 발송", "게시판에서 확인"

---

## 상의 필요 — 김동건 (④ 화면)

> 위 체크리스트는 송유진 님 항목이라 닫지 않았습니다. ④ 화면을 만들며 걸린 것만 적습니다.

- "발화 N개" → "음성 N개": #83 리뷰 흐름(영상·음성을 분류와 함께 먼저 올려 STT)이면 분류 결과에 "발화 N개"를 그대로 보일 수 있어 이 항목은 필요 없어집니다. FE는 "사진 N장 · 영상 N개 · 음성 N개 · 발화 N개"로 셉니다.
- 숨길 UI의 "+ 추가 근거 작성": 아이 카드에서 "오늘 하루 확인 →"로 바꾸고, 추가 근거는 아이별 하루 확인 안에서 씁니다(#83 리뷰). 직접 작성 화면(③ 정은)은 두지 않기로 했습니다(10/06 회의). 자료 없는 원아는 초안 검토 화면에서 직접 씁니다. 분류 결과 화면의 "직접 기록 →"은 갈 화면이 없어져, 링크를 빼거나 안내 문구로 바꿉니다(김동건).
- 아이별 하루 확인은 Figma 1:3115(하루 정리 확인)를 전송 전 자료로 그린 것입니다. 서버 하루 일과가 아니라서 Figma의 활동 이름("미술 활동")과 장면 문장은 없고, 사진·발화를 시간순으로 보여 줍니다. "2 / 5명 확인"은 자료가 있는 아이 사이 이동으로 바꿨습니다.
