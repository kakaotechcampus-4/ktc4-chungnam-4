# 미정 사항 체크리스트

정해지면 **취소선**을 긋고 반영 위치를 적습니다. 전부 반영되면 이 파일을 지웁니다.

> 권위는 `docs/테크스펙.md`입니다. 여기서 정한 건 테크스펙에 먼저 반영하고, 그 다음 `CLAUDE.md`에 옮깁니다.

## A. 컨벤션

- [x] ~~인덴트·포매터 (TS 2 / Python 4, Prettier + Ruff)~~ → 루트 §4, `backend/CLAUDE.md` §2
- [x] ~~저장소 구조: monorepo~~ → 채택
- [x] ~~브랜치 전략 `main`/`develop` + 기능 브랜치~~ → 루트 §4
- [x] ~~머지 방식: Squash~~ → 루트 §4
- [x] ~~PR 승인 인원: 1명~~ → 루트 §4
- [x] ~~JSON 필드 케이스: snake_case~~ → `backend/CLAUDE.md` §4
- [x] ~~도메인 용어 표~~ → 루트 §2
- [ ] `.editorconfig` + pre-commit 훅 도입 여부
- [ ] 에러 응답의 세부 필드명 — `detail` vs `details` vs 생략

## B. 구조 · 인프라

- [x] ~~Celery 범위를 파이프라인 4~7단계로 제한~~ → `backend/CLAUDE.md` §6
- [x] ~~컨테이너·DB 타임존 Asia/Seoul (저장은 UTC)~~ → `backend/CLAUDE.md` §5
- [ ] ONNX 모델 배포 방식: git-lfs vs S3/CDN vs `public/` 직접 포함
- [ ] 로컬 개발 환경: Docker Compose 통일 vs 각자 로컬 실행
- [ ] CI에서 막을 것: 린트 / 타입체크 / 테스트 / 빌드 중 어디까지
- [ ] `backend/.importlinter` — 채울지 지울지 (현재 0바이트. 빈 설정 파일이 제일 나쁨)

## C. 스펙 미정 (코드 구조에 영향)

- [x] ~~얼굴 임베딩 저장 위치~~ → **09/03 서버 저장(FaceEmbedding, AES `bytea`)으로 결정.** 테크스펙 L434, H-3, `domains/face/CLAUDE.md`
- [x] ~~FR-10 학부모 다운로드 / 공지 게시판~~ → **should로 내림** (테크스펙 FR 표)
- [ ] FR-19 미승인 초안 보존 기간 — 테크스펙에 `?시간`으로 비어 있음
- [ ] 요구사항 ID 공란(FR-02) 재정렬 시점
- [ ] 동의 철회 흐름 — 철회 시 기존 임베딩·기록 처리
- [ ] 미동의 아동 제외 방식 — 제외 vs 블러 후 제외
- [ ] 단체사진 처리 (전원 동의 전제 여부)
- [ ] 영상·음성 파일이 없는 날의 서비스 동작
- [ ] 동의서 법적 문구 확정 (테크스펙 데이터모델 ② "수정 필요")
- [ ] `ConsentRecord` 소유 도메인 — face vs organization
- [ ] `UnclassifiedItem` 소유 도메인 — media vs documents

## D. 인증

- [ ] `CurrentUser`에 담을 범위 — `class_ids`/`child_ids`를 JWT에 넣을지, 요청마다 조회할지
- [ ] Celery task의 권한 처리 — `account_id`를 인자로 넘길지, 시스템 권한으로 돌릴지

## E. 문서 관리

- [x] ~~문서 위치와 갱신 규칙~~ → 루트 §7 (저장소 먼저, Notion 나중)
- [x] ~~ADR 사용 여부~~ → **쓰지 않음.** 이유 한 줄로 대체 (사람만 볼 이유는 HTML 주석)
- [x] ~~컨벤션 변경 절차~~ → 루트 §7 (`[fix]` 직접 push / `[rule]` PR + 승인)
- [ ] 도메인별 담당자 확정 — 7개 도메인 중 `agents`만 정해짐
