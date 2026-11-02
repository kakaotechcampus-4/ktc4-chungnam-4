---
name: create-branch
description: 작업 브랜치를 만들 때 사용. "브랜치 파줘", "새 브랜치", 새 이슈·작업을 시작할 때, 멘토 피드백을 반영하기 시작할 때. 아이담 팀의 브랜치 명명 규칙과 분기 기준을 적용한다.
---

# 브랜치 만들기

## 브랜치 구조

```
main          # 보호 브랜치. 주간 리뷰를 통과한 결과. develop → main PR만 허용 → 멘토 리뷰 → approve 시 merge
develop       # 멘토 리뷰 기준. 리뷰 중(develop → main PR이 열려 있음)에는 동결 — 리뷰 반영만 들어감
develop-next  # 리뷰 중에 새 기능을 받아 두는 곳 (기본 브랜치)
feat/<파트>/…      # 기능 단위. 리뷰 중이면 develop-next, 리뷰가 끝났으면 develop에서 분기 → 같은 곳으로 PR
refactor/<파트>/…  # 멘토 피드백 반영. develop에서 분기 → develop으로 PR
```

**분기 기준은 타입과 멘토 리뷰 상태가 정합니다.** `refactor`(리뷰 반영)는 항상 `develop`입니다. `feat`는 **주간 `develop` → `main` PR이 열려 있으면(리뷰 중) `develop-next`, 없으면(가장 최근 주간 PR이 머지돼 리뷰가 끝남) `develop`** 입니다. 리뷰 중인 주간 PR이 `develop`을 그대로 보기 때문에 그동안 새 기능은 `develop-next`에 받아 둡니다. 리뷰가 끝나면 `develop`이 얼어 있을 이유가 없고, CI·자동 리뷰·파트 리뷰어 배정이 `develop` 대상 PR에서만 돌기 때문에 바로 `develop`으로 보냅니다. 이미 PR로 머지된 브랜치를 재사용하지 않습니다 — PR 목록에서 주차 구분이 안 됩니다.

`feat`를 만들기 전에 리뷰 상태부터 확인합니다.

```bash
git fetch origin
gh pr list --base main --state open --json number,title   # 결과가 있으면 리뷰 중
```

```bash
git switch -c feat/<파트>/<작업내용> origin/develop-next   # 리뷰 중
git switch -c feat/<파트>/<작업내용> origin/develop        # 리뷰가 끝남
git switch -c refactor/<파트>/<작업내용> origin/develop
```

**`develop`에서 `feat`를 만들 때 `develop-next`를 base로 한 열린 PR이 남아 있으면 경고합니다.** `gh pr list --base develop-next --state open`의 목록(번호·작성자)을 사용자에게 보여 주고, **push하기 전에 디스코드에서 각 PR 작성자에게 어떻게 할지 물어보라**고 말합니다. 남의 PR base를 대신 바꾸지 않습니다 — 그 PR을 `develop-next`에 남길지, base를 옮길지는 작성자가 정합니다.

첫 push에서 upstream을 바로잡습니다. 위 명령은 upstream을 분기한 장수 브랜치(`origin/develop-next`·`origin/develop`)로 잡아두기 때문입니다.

```bash
git push -u origin <브랜치명>
```

## 이름 규칙

`<타입>/<파트>/<작업내용>`

- **타입**: `feat` `refactor` — 커밋 타입과 같은 단어를 씁니다. `feature`가 아닙니다. 두 벌을 외우지 않게 하려는 것입니다.
- **파트**: `ai` / `be` / `fe`. 이슈마다 브랜치를 새로 파기 때문에 파트가 없으면 목록에서 누구 작업인지 구분이 안 됩니다.
- **작업내용**: 영어 kebab-case. **반드시 붙입니다.** 같은 영역을 여러 주에 걸쳐 건드리므로 이름이 겹치면 로그를 못 읽습니다.

예: `feat/be/agent-pipeline`, `refactor/fe/week1-mentor-feedback`

`main`·`develop`·`develop-next`는 고정 이름이라 이 규칙의 대상이 아닙니다.

**미정**: 문서 전용 작업의 파트 표기가 규칙에 없습니다. 선례는 파트 없이 쓴 `feat/docs-claude-hierarchy`와 `refactor/docs/mentor-review`입니다. 이름을 임의로 정하지 말고 사용자에게 물어보세요 (`docs/open-questions.md`).

## 브랜치를 만든 뒤

**작업 시작 전 이슈·스레드에 "나 이거 잡는다"를 남기라고 사용자에게 알려줍니다.** 6명이 병렬로 움직이므로 이게 없으면 같은 파일을 두 사람이 고칩니다.

자기 담당이 아닌 도메인을 건드리는 작업이면 담당자에게 알리라고 함께 말합니다 (`backend/README.md` §폴더 구조와 담당 범위).
