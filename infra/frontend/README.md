# FE 배포 자원 (CloudFront + S3)

화면(S3)과 API(EC2)를 CloudFront 주소 하나로 묶습니다. 결정 근거는 이슈 #118(송유진 결정·멘토 승인, #124 리뷰)이고, 요구사항은 NFR-13·14·15입니다.

```
https://<무작위>.cloudfront.net
 ├─ /api/*  → BE(EC2 Caddy) 그대로 · CachingDisabled · AllViewerExceptHostHeader · 메서드 전체
 └─ 나머지  → S3 버킷(비공개, OAC) · CachingOptimized · SPA 함수(viewer-request)
```

| 파일 | 내용 |
|---|---|
| `aidam-fe.yaml` | CloudFormation 템플릿. 버킷·버킷 정책·OAC·SPA 함수·`/api` 응답 헤더 정책·배포·FE 배포 역할 |
| `upload.sh` | 빌드 결과를 캐시 규칙대로 올립니다. 배포 워크플로(별도 PR)와 손 배포가 같이 씁니다 |
| `smoke.sh` | 배포 주소에서 화면·`/api`를 확인하고, 본인 권한일 때는 배포 설정까지 확인합니다 |

**콘솔에서 설정을 고치지 않습니다.** 이 템플릿이 원본입니다. 콘솔에서 바꾸면 리뷰 없이 바뀐 설정이 남고, 일반 change set으로 적용해도 저절로 되돌아가지 않습니다(drift는 change set에 보이지 않습니다).

AWS 명령은 AWS 콘솔의 **CloudShell(서울, ap-northeast-2)** 에서 돌립니다. 로컬에 AWS CLI가 있으면 로컬에서 돌려도 됩니다.

## 처음 만들기와 설정 바꾸기

1. 템플릿을 고치는 PR을 올립니다. 리뷰어: 엄태은(같은 AWS 계정, BE 원본 담당)
2. CloudShell에서 리뷰받는 커밋을 받습니다. CloudShell 홈은 세션 사이에 남으므로 이미 받아 둔 저장소가 있으면 그것을 씁니다. change set을 만들 때와 실행할 때 `git rev-parse HEAD`가 같은지 확인합니다
   ```bash
   cd ~ && { [ -d ktc4-chungnam-4 ] || git clone https://github.com/kakaotechcampus-4/ktc4-chungnam-4.git; }
   cd ~/ktc4-chungnam-4 && git fetch origin && git checkout <PR 헤드 커밋>
   ```
3. (바꿀 때만) 손으로 바뀐 곳이 없는지 먼저 봅니다. `DRIFTED`가 나오면 그 차이를 PR에 적고 처리 방법을 정한 뒤 진행합니다
   ```bash
   id=$(aws cloudformation detect-stack-drift --region ap-northeast-2 --stack-name aidam-fe --query StackDriftDetectionId --output text)
   until [ "$(aws cloudformation describe-stack-drift-detection-status --region ap-northeast-2 --stack-drift-detection-id "$id" --query DetectionStatus --output text)" != DETECTION_IN_PROGRESS ]; do sleep 5; done
   aws cloudformation describe-stack-drift-detection-status --region ap-northeast-2 --stack-drift-detection-id "$id" --query StackDriftStatus --output text
   aws cloudformation describe-stack-resource-drifts --region ap-northeast-2 --stack-name aidam-fe --stack-resource-drift-status-filters MODIFIED DELETED
   ```
4. change set을 만들어 무엇이 바뀌는지 봅니다(아직 적용 안 됨). `ApiOriginDomain`은 backend `.env`의 `PUBLIC_HOST` 값입니다(`https://` 없이 호스트 이름만)
   ```bash
   aws cloudformation deploy --region ap-northeast-2 --stack-name aidam-fe \
     --template-file infra/frontend/aidam-fe.yaml --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides BucketName=<버킷> ApiOriginDomain=<PUBLIC_HOST> \
     --no-execute-changeset
   aws cloudformation describe-change-set --region ap-northeast-2 --stack-name aidam-fe \
     --change-set-name <위 출력의 이름> \
     --query 'Changes[].ResourceChange.[Action, LogicalResourceId, ResourceType, Replacement]' --output table
   ```
5. 표를 PR에 붙입니다. `Replacement: True`인 줄이 있으면 리뷰에서 따로 짚습니다. 배포가 교체되면 주소가 바뀌어 아래 GitHub variable `FE_DOMAIN`과 "FE 주소를 쓰는 곳"의 값을 모두 다시 옮겨야 합니다
6. 승인 뒤 적용하고 머지합니다
   ```bash
   aws cloudformation execute-change-set --region ap-northeast-2 --stack-name aidam-fe --change-set-name <이름>
   aws cloudformation wait stack-update-complete --region ap-northeast-2 --stack-name aidam-fe   # 처음이면 stack-create-complete
   ```
7. 본인 권한으로 배포 설정까지 확인합니다. FE 배포 역할은 배포 설정을 읽지 못해서 워크플로는 이 5번 검사를 건너뜁니다. 처음 만들 때는 버킷이 비어 있어 1번이 실패하므로, 아래 "손으로 배포하기" 뒤에 돌립니다
   ```bash
   FE_DOMAIN=<DistributionDomainName> FE_DISTRIBUTION_ID=<DistributionId> bash infra/frontend/smoke.sh
   ```

`CAPABILITY_NAMED_IAM`은 템플릿이 이름을 정한 IAM 역할(`aidam-fe-deploy`)을 만들기 때문에 필요합니다.

change set은 문법·이름 충돌 같은 사전 검증까지만 합니다(IAM 역할·버킷 정책은 사전 검증 대상이 아니고, 역할 이름 충돌도 실행 때 드러납니다). 우리 권한과 캠퍼스 SCP가 자원 생성을 허용하는지는 실행 때 드러나고, 실패하면 스택이 자동으로 되돌아갑니다([사전 검증 범위](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/validate-stack-deployments.html)).

- 처음 만들 때 실행이 실패하면 스택이 `ROLLBACK_COMPLETE`로 남습니다. 이 상태에서는 지우는 것만 할 수 있습니다. `aws cloudformation describe-stack-events --region ap-northeast-2 --stack-name aidam-fe`로 `CREATE_FAILED` 줄을 확인하고, `delete-stack`과 `wait stack-delete-complete` 뒤 4단계부터 다시 합니다. 버킷은 `RetainExceptOnCreate`라 롤백 때 이미 지워졌습니다
- 처음 만들 때 change set만 만들고 실행하지 않기로 했다면, `REVIEW_IN_PROGRESS`로 남은 빈 스택을 `delete-stack`으로 지웁니다. 설정을 바꿀 때는 스택을 지우지 말고 `aws cloudformation delete-change-set --region ap-northeast-2 --stack-name aidam-fe --change-set-name <이름>`으로 change set만 지웁니다

**change set을 만들기 전에** `gh api repos/kakaotechcampus-4/ktc4-chungnam-4/actions/oidc/customization/sub`의 `sub_claim_prefix`가 템플릿의 `GitHubSubjectPrefix`와 같은지 봅니다. 적용 뒤에는 `aws iam get-role --role-name aidam-fe-deploy`로 신뢰 정책의 `sub`가 그 값 + `:ref:refs/heads/develop`인지 확인합니다. 이 저장소는 2026-07-15 이후에 만들어져 GitHub의 **불변 subject 형식**(`repo:<조직>@<조직ID>/<저장소>@<저장소ID>:...`)이 기본입니다([GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc)).

## 처음 만든 뒤 옮길 값

`aws cloudformation describe-stacks --region ap-northeast-2 --stack-name aidam-fe --query 'Stacks[0].Outputs'`

| Output | GitHub | 종류 |
|---|---|---|
| `BucketName` | `FE_BUCKET` | variable |
| `DistributionDomainName` | `FE_DOMAIN` | variable |
| `DeployRoleArn` | `FE_DEPLOY_ROLE_ARN` | **secret** — AWS는 계정 ID를 비밀로 보지 않지만, 공개 저장소라 노출을 줄이려고 secret에 둡니다 |
| `DistributionId` | 넣지 않음 | FE 배포 역할에 무효화·설정 읽기 권한이 없습니다(NFR-14). 본인 권한으로 돌리는 `upload.sh` 무효화(5단계)와 `smoke.sh` 5번에만 씁니다 |

**FE 주소를 쓰는 곳** — 값은 모두 `https://<DistributionDomainName>`(끝 슬래시 없음)입니다.

| 쓰는 곳 | 담당 | 언제부터 필요 |
|---|---|---|
| BE 신뢰 출처 설정(CSRF, 이름 미정, `docs/open-questions.md`) | 엄태은 | CSRF 미들웨어가 들어온 뒤 |
| (제안) 미디어 업로드 버킷 CORS. 허용 출처는 이 주소(`*` 금지, 로컬 `http://localhost:5173`을 같은 버킷에 넣을지는 담당 확인), 메서드 PUT, 헤더는 `upload_headers`에 들어가는 것 | 김동건 | presigned 업로드가 들어온 뒤 |
| 학부모 초대 링크 기준 주소 | BE | 초대 링크를 만들 때(`docs/open-questions.md`) |

## 손으로 배포하기 (워크플로를 켜기 전 확인용)

머지 뒤 배포는 워크플로가 맡습니다. 워크플로 파일이 develop에 들어가기 전에는 실행할 수 없고 FE 배포 역할도 develop만 받으므로, 그 전 확인은 이 절차로 합니다. 빌드는 로컬에서, 업로드는 CloudShell에서 합니다(CloudShell에는 pnpm이 없고 Node 버전도 맞지 않습니다).

1. 로컬에서 빌드하고 저장소 밖(홈)에 묶습니다. Finder의 '압축'은 쓰지 않습니다(`__MACOSX/`가 섞여 버킷에 올라갑니다)
   ```bash
   cd frontend && pnpm install --frozen-lockfile && pnpm build && (cd dist && zip -qr "$HOME/fe-dist.zip" .)
   ```
2. CloudShell에서 Actions → Upload file로 `fe-dist.zip`을 올립니다(홈에 올라갑니다). 위 "처음 만들기" 2단계처럼 같은 커밋을 받은 뒤, 홈에서 실행합니다. 지난번 `dist`가 남아 있으면 섞이므로 지우고 풉니다
   ```bash
   cd ~ && rm -rf dist && unzip -q fe-dist.zip -d dist
   FE_BUCKET=<버킷> [FE_DISTRIBUTION_ID=<배포 ID>] bash ~/ktc4-chungnam-4/infra/frontend/upload.sh dist
   FE_DOMAIN=<xxxx.cloudfront.net> [FE_DISTRIBUTION_ID=<배포 ID>] bash ~/ktc4-chungnam-4/infra/frontend/smoke.sh
   ```
3. 브라우저로 `/`와 `/t/today`를 직접 열어 화면이 뜨는지 봅니다

CloudShell에 `/etc/mime.types`가 없으면 `.woff2`가 `binary/octet-stream`으로 올라가지만 글꼴은 그대로 동작합니다.

## 캐시 규칙

기간은 제안입니다(`docs/open-questions.md` "정적 파일 캐시 기간과 무효화"). 바뀌면 이 표와 `upload.sh`를 같이 고칩니다.

| 대상 | Cache-Control | 이유 |
|---|---|---|
| `assets/*` | `public, max-age=31536000, immutable` | 이름에 내용 해시가 있어 내용이 바뀌면 이름이 바뀝니다 |
| `models/<해시>/*` | `public, max-age=31536000, immutable` | (제안, #121 리뷰) 얼굴 모델(HUMAN)은 `cacheModels: false`로 두고 브라우저 HTTP 캐시만 쓰는 안입니다. 확정 전입니다(`docs/open-questions.md` "브라우저 얼굴 모델 파일"). `<해시>`는 그 디렉터리에 올리는 파일 전체(json·bin)의 내용 해시이고 `model_version`과 다릅니다. 파일이 하나라도 바뀌면 새 디렉터리로 올리고 옛 디렉터리는 지우지 않습니다. `models/` 바로 아래 파일은 `upload.sh`가 거부합니다 |
| `index.html` | `no-cache` | 새 배포를 바로 받게 매번 재검증합니다(ETag → 304) |
| 그 밖의 `public/` 파일 | `no-cache` | 이름에 해시가 없습니다 |
| `/api/*` | BE가 `no-store`(1차), 없으면 응답 헤더 정책이 채움 | CloudFront 캐시는 CachingDisabled가 막습니다 |

`index.html`은 `no-cache`라 CachingOptimized의 최소 TTL(1초) 뒤에는 새 파일이 나갑니다. 그래서 워크플로는 무효화하지 않습니다. 본인 권한으로 손 배포할 때 `FE_DISTRIBUTION_ID`를 주면 `/`, `/index.html` 두 경로를 무효화합니다.

## 오류 처리

커스텀 오류 응답(403/404 → `index.html`)을 쓰지 않습니다. 그 설정은 동작별이 아니라 배포 전체 설정이라 `/api`의 403·404 JSON(`CLASS_ACCESS_DENIED`, `CLASS_NOT_FOUND` 등)도 `index.html`로 바뀝니다. 401은 CloudFront가 커스텀 오류 페이지를 걸 수 있는 코드(CloudFront가 캐시하는 오류 코드) 목록에 없어 해당하지 않습니다([오류 코드 처리](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HTTPStatusCodes.html)).

화면 주소는 SPA 함수가 `index.html`로 바꿉니다.

- 마지막 경로 조각에 `.`이 있으면 파일로 보고 S3로 보냅니다. `/models/<해시>/*.json`·`.bin`도 그대로 S3로 갑니다
- `/t/`·`/p/`·`/invite/` 아래는 경로에 `.`이 있어도 화면 주소로 봅니다. 그래서 이 경로들 아래에는 정적 파일을 두지 않습니다(초대 링크가 `/invite/`인지 `/p/invite/`인지 맞출 때까지 둘 다 받음)
- 없는 파일은 S3가 403을 줍니다(`s3:ListBucket`을 CloudFront에 주지 않아서)

## 끝낼 때 (시연 뒤)

1. `aws cloudformation delete-stack --region ap-northeast-2 --stack-name aidam-fe` — 배포·역할·함수·정책이 지워집니다
2. 버킷은 `RetainExceptOnCreate`라 남습니다. 콘솔에서 비우고 지웁니다
