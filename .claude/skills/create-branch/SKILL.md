---
name: create-branch
description: 작업 브랜치를 만들 때 사용. "브랜치 파줘", "새 브랜치", 새 이슈·작업을 시작할 때, 멘토 피드백을 반영하기 시작할 때. 아이담 팀의 브랜치 명명 규칙과 분기 기준을 적용한다.
---

# 브랜치 만들기

## 브랜치 구조

```
main        # 보호 브랜치. develop → main PR만 허용 → 멘토 리뷰 → approve 시 merge
develop     # 기본 작업 브랜치
feat/<파트>/…      # 기능 단위. develop에서 분기 → develop으로 PR
refactor/<파트>/…  # 멘토 피드백 반영. develop에서 분기 → develop으로 PR
```

**항상 `develop`에서 분기합니다.** 이미 PR로 머지된 브랜치를 재사용하지 않습니다 — PR 목록에서 주차 구분이 안 됩니다.

```bash
git fetch origin
git switch -c <타입>/<파트>/<작업내용> origin/develop
```

첫 push에서 upstream을 바로잡습니다. 위 명령은 upstream을 `origin/develop`으로 잡아두기 때문입니다.

```bash
git push -u origin <브랜치명>
```

## 이름 규칙

`<타입>/<파트>/<작업내용>`

- **타입**: `feat` `refactor` — 커밋 타입과 같은 단어를 씁니다. `feature`가 아닙니다. 두 벌을 외우지 않게 하려는 것입니다.
- **파트**: `ai` / `be` / `fe`. 이슈마다 브랜치를 새로 파기 때문에 파트가 없으면 목록에서 누구 작업인지 구분이 안 됩니다.
- **작업내용**: 영어 kebab-case. **반드시 붙입니다.** 같은 영역을 여러 주에 걸쳐 건드리므로 이름이 겹치면 로그를 못 읽습니다.

예: `feat/be/agent-pipeline`, `refactor/fe/week1-mentor-feedback`

`main`·`develop`은 고정 이름이라 이 규칙의 대상이 아닙니다.

**미정**: 문서 전용 작업의 파트 표기가 규칙에 없습니다. 선례는 파트 없이 쓴 `feat/docs-claude-hierarchy`와 `refactor/docs/mentor-review`입니다. 이름을 임의로 정하지 말고 사용자에게 물어보세요 (`docs/open-questions.md`).

## 브랜치를 만든 뒤

**작업 시작 전 이슈·스레드에 "나 이거 잡는다"를 남기라고 사용자에게 알려줍니다.** 6명이 병렬로 움직이므로 이게 없으면 같은 파일을 두 사람이 고칩니다.

자기 담당이 아닌 도메인을 건드리는 작업이면 담당자에게 알리라고 함께 말합니다 (`backend/README.md` §폴더 구조와 담당 범위).
