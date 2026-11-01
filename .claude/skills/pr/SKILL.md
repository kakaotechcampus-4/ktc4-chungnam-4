---
name: pr
description: PR을 만들거나 PR 리뷰 코멘트를 달 때 사용. "PR 올려줘", "PR 본문 써줘", "리뷰 남겨줘". 아이담 팀의 PR 규약(분량, 요구사항 ID, 리뷰 태그, 머지 방식)을 적용한다.
---

# PR 만들기 · 리뷰하기

## PR 본문

- **관련 요구사항 ID를 답니다** — `FR-04`, `NFR-06`. **ID를 못 적으면 근거 없는 코드라는 신호입니다.** 그때는 PR을 올리기 전에 `docs/테크스펙.md`에서 근거를 찾거나, 없으면 `docs/open-questions.md`에 질문으로 올립니다.
- 스펙(요구사항 ID, 데이터 모델, 인터페이스)이 바뀌었으면 **`docs/테크스펙.md`를 먼저 고치고** PR 본문에 링크합니다. 코드가 스펙을 앞서가면 안 됩니다.
- 본문은 한국어로 씁니다. 제목은 영어입니다.

## 분량과 머지

- **300줄 이하** 목표. 넘으면 나눌 수 있는지 먼저 검토합니다.
- 리뷰어 **1명 승인 + CI 통과** 후 **Merge commit**으로 합칩니다(저장소 설정상 Squash는 꺼져 있습니다). 승인을 받았으면 **작성자가 직접 머지**합니다 — 리드를 기다리지 않습니다.
- **장수 브랜치끼리는 Merge로만 합칩니다** — `develop-next` → `develop`, `develop` → `develop-next`, `develop` → `main`. Squash하면 다음 주에 지난 변경이 다시 올라오고 충돌이 납니다.
- **작업 브랜치 PR도 Squash하지 않습니다.** 머지 안 된 PR 위에 쌓은 브랜치가 있으면, 아래 PR을 Squash하는 순간 위 브랜치와 커밋 ID가 어긋나 충돌이 납니다. PR 단위 기록은 `git log --first-parent`로 봅니다 — 머지 커밋 한 줄이 PR 하나입니다.
- **PR을 올리기 전에 base 브랜치를 먼저 머지해 최신화**합니다(`feat`는 `develop-next`, `refactor`는 `develop`). 충돌은 올린 사람이 풉니다.

## 리뷰어 지정

- 리드 영역의 **구조 변경**(디렉터리 추가, 의존성 추가, 공통 모듈 수정)은 해당 리드를 리뷰어로 넣습니다 — FE 송유진 / BE 엄태은 / AI·에이전트 한상균.
- 자기 담당이 아닌 도메인을 건드렸으면 그 담당자를 넣습니다 (`backend/README.md` §폴더 구조와 담당 범위).
- **응답 스키마에서 필드를 삭제·개명하면 제목에 `[BREAKING]`을 붙이고 FE 리드를 리뷰어로 지정합니다.**

## 같이 갱신해야 하는 것

- **마이그레이션이 포함된 PR은 `docs/테크스펙.md`의 ERD도 같이 갱신합니다.**
- 문서 계층 중 한 곳을 고쳤으면 `docs/doc-management.md` §하나를 고치면 같이 봐야 하는 것 표를 확인합니다.

## 리뷰 코멘트

`[must]` / `[ask]` / `[nit]`로 구분해서 씁니다. 등급이 없으면 받는 사람이 "고쳐야 하나 의견인가"를 매번 되묻게 됩니다.

- `[must]` 머지 전에 고쳐야 함
- `[ask]` 의도를 묻는 것
- `[nit]` 취향·개선 제안, 안 고쳐도 됨

## 주간 흐름

`main`은 보호 브랜치입니다. `develop` → `main` PR만 허용되고 멘토 리뷰 후 approve 시 merge됩니다.

**PR base는 타입이 정합니다.** `feat/*` → `develop-next`, `refactor/*`(리뷰 반영) → `develop`. 기본 브랜치가 `develop-next`라 `refactor` PR은 base를 직접 `develop`으로 바꿔야 합니다.

```
월 ~ 수 18:00 전
  feat/* ──PR──▶ develop-next          (수시로 머지)
  develop-next ──PR(merge)──▶ develop  (수 18:00 전, 이번 주 리뷰 범위 확정)
  develop ──PR──▶ main                 (수 18:00, 팀장이 주간 PR 생성)

수 18:00 ~ 일 (리뷰 기간)
  feat/* ──PR──▶ develop-next          (계속 머지)
  refactor/* ──PR──▶ develop           (리뷰 반영만 develop으로)
  develop ──merge──▶ develop-next      (리뷰 반영이 들어갈 때마다 역머지)

일
  develop ──merge──▶ main              (멘토 승인 뒤, 23:59까지)
  develop ──merge──▶ develop-next      (남은 역머지 마무리)
```

- **리뷰 기간의 `develop`에는 리뷰 반영만 넣습니다.** 새 기능은 `develop-next`로 보냅니다.
- **역머지를 미루지 않습니다.** 리뷰 반영이 `develop`에 들어가면 바로 `develop` → `develop-next`로 합칩니다. 늦어도 일요일 병합 직후에는 합쳐야 수요일 `develop-next` → `develop`이 깨끗합니다.
