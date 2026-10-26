---
name: deploy
description: 배포하거나 CI 워크플로를 만들·고칠 때 사용. "배포해줘", "GitHub Actions 만들어줘", "워크플로 고쳐줘". 아이담 팀의 배포 순서와 CI 규약을 적용한다.
---

# 배포 · CI

## CI는 GitHub Actions로

빌드·배포 자동화는 **GitHub Actions**로 만듭니다 (09/19 결정). 워크플로는 `.github/workflows/`에 둡니다.

**CI에서 무엇까지 막을지(린트/타입체크/테스트/빌드)는 아직 미정**입니다 — `docs/open-questions.md` §B에 열려 있습니다. 상상해서 채우지 말고, 필요하면 거기에 질문으로 올리세요.

워크플로 추가·수정은 공용 영역이라 **BE 리드(엄태은)가 리뷰어**입니다. `.github/workflows/`와 `infra/`를 고친 PR에는 엄태은·송유진이 리뷰어로 자동 지정됩니다(`assign-part-reviewers.yml`). 파트 리뷰어를 CODEOWNERS에 넣지 않는 이유는 그 워크플로 파일 머리말에 있습니다(`main` 룰셋에서 승인까지 강제됨).

## 배포는 한 번에 하지 않습니다

**완성본을 한 번에 올리지 않고, 단계마다 서버가 정상 동작하는지 확인하고 다음으로 갑니다** (09/19 결정). 한 번에 올리면 어느 변경이 서버를 죽였는지 좁힐 수 없고, 되돌릴 지점도 없습니다.

한 단계를 올릴 때마다:

1. 배포한다
2. **서버가 뜨는지, 헬스 체크가 통과하는지 확인한다**
3. 확인이 끝나야 다음 단계를 올린다

확인에 실패하면 다음 단계로 넘어가지 말고 **되돌리거나 그 단계를 고칩니다.**

## FE 배포 (CloudFront + S3)

화면(S3)과 API(EC2)를 CloudFront 주소 하나로 내보냅니다(이슈 #118, 송유진 결정·멘토 승인). 자원 설정의 원본은 `infra/frontend/aidam-fe.yaml`, 절차와 캐시 규칙은 `infra/frontend/README.md`입니다.

| 대상 | 이름 |
|---|---|
| CloudFormation 스택 · S3 버킷 | `aidam-fe` (서울) |
| FE 배포 역할 | `aidam-fe-deploy` |
| 워크플로 | `deploy-frontend.yml` (Actions 이름 "Deploy frontend") |
| GitHub environment | `frontend` (배포 브랜치 develop만) |
| 배포 태그 | `fe-deploy-YYYYMMDD-HHMM` (BE는 `deploy-*`) |
| GitHub 설정 | variables `FE_BUCKET`·`FE_DOMAIN`, secret `FE_DEPLOY_ROLE_ARN` |

- develop에 `frontend/`가 바뀐 커밋이 들어오면 워크플로가 빌드해 올리고 스모크를 돌립니다. 템플릿만 바꾼 PR은 change set으로 적용합니다(README).
- 되돌리기(NFR-15): Actions → Deploy frontend → Run workflow를 **develop에서** 돌리고 `rollback_tag`에 되돌릴 태그를 넣습니다.
- FE 배포 역할은 environment `frontend`를 쓰는 job만 받습니다(NFR-14). **다른 워크플로에 `environment: frontend`를 붙이지 않습니다.** 붙이면 그 워크플로도 FE 버킷을 쓸 수 있게 됩니다.
- **CloudFront·버킷·역할을 콘솔에서 고치지 않습니다.** 템플릿을 고치는 PR → change set → 적용 순서입니다.
- **`/api/*` 캐시를 켜지 않고, 배포 전체의 오류 페이지(403·404 → `index.html`)를 걸지 않습니다.** 원아 정보가 담긴 응답이 엣지에 남거나, `/api`의 403·404 JSON이 `index.html`로 바뀝니다.
- 계정 ID·역할 ARN은 문서·워크플로에 적지 않습니다(공개 저장소).

## 비밀값

- 키·URL·비밀번호를 워크플로 파일에 박지 않습니다. GitHub Secrets를 쓰고, `.env.example`에는 **키 이름과 설명만** 둡니다 (루트 §환경변수).
- 키가 커밋됐으면 되돌리는 것으로 끝내지 말고 **즉시 폐기·재발급**합니다.

### 서버 `.env`에 키 넣기

`.env.example`에 키가 생기면 **그 PR을 머지하기 전에** 서버 `.env`에도 넣습니다 (루트 §환경변수, 10/17 #151 배포 실패). `backend/scripts/deploy.sh`가 `.env.example`과 키 목록을 대조해, 빠진 키가 있으면 빌드 전에 멈춥니다.

1. 카테캠 포털 → 팀 계정 → 서울 리전 → EC2 → 연결 → **Session Manager**로 접속합니다.
2. `sudo -iu ubuntu`로 배포 사용자로 바꾼 뒤 **`/opt/aidam/backend.env`** 를 고칩니다. 앱 폴더의 `/opt/aidam/app/backend/.env`는 배포 때마다 이 파일로 덮어써지므로 고치지 않습니다.
3. 이미 배포가 실패했다면 Actions → **Deploy to EC2** → Run workflow로 다시 돌립니다.
4. 채널에 **추가한 키 이름만** 남깁니다. 서버 파일은 변경 이력이 남지 않습니다. 값은 적지 않습니다.
