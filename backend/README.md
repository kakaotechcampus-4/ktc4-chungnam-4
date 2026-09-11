# 아이담 백엔드

아이담은 영상·사진·음성에서 수집한 맥락을 바탕으로 원아의 하루를 기록하는 AI 알림장·관찰일지 서비스입니다.

이 문서는 **처음 실행하는 팀원과 도메인 구현을 시작하는 팀원**을 위한 공통 개발 안내입니다.

> **현재 구현 범위:** FastAPI 실행, PostgreSQL 연결, 환경변수 관리, 공통 DB 세션, 헬스체크와 환경 테스트.
> 현재 Compose는 **백엔드 API와 PostgreSQL 두 서비스**를 실행합니다. 도메인 API·Alembic 마이그레이션·Redis·Celery는 아직 구현하지 않았습니다. AWS 서버 설치·배포는 접속 후 검증이 필요합니다.

## 바로가기

- [1. 처음 실행하기](#1-처음-실행하기)
- [2. 개발 중 사용하는 명령](#2-개발-중-사용하는-명령)
- [3. 테스트하기](#3-테스트하기)
- [4. 폴더 구조와 담당 범위](#4-폴더-구조와-담당-범위)
- [5. 공통 코드 사용 방법](#5-공통-코드-사용-방법)
- [6. 환경변수와 의존성 관리](#6-환경변수와-의존성-관리)
- [7. 브랜치와 PR](#7-브랜치와-pr)
- [8. 자주 발생하는 문제](#8-자주-발생하는-문제)
- [9. AWS 서버에서 실행하기](#9-aws-서버에서-실행하기)

## 1. 처음 실행하기

### 준비물


| 도구                         | 필요한 경우                                     |
| -------------------------- | ------------------------------------------ |
| Git                        | 저장소와 작업 브랜치 관리                             |
| Docker Desktop 또는 OrbStack | API와 PostgreSQL 실행. **앱/엔진이 실행 중이어야 합니다.** |
| Docker Compose 2.20 이상     | 루트 Compose의 `include` 지원                   |
| Python 3                   | 환경변수 파일 생성                                 |
| Python 3.12                | 호스트에서 단위 테스트 실행                            |


서버의 Python 3.12는 Docker 이미지에 포함되어 있습니다. Docker로 API를 실행할 때 호스트에 Python 패키지를 별도로 설치할 필요는 없습니다.

**아래 명령은 저장소 루트(`ktc4-chungnam-4/`)에서 실행합니다.** 현재 환경 설정이 포함된 브랜치를 먼저 받아야 합니다.

### ① 개인 환경변수 파일 생성

```bash
python3 backend/scripts/init_env.py
```

- `backend/.env.example`을 바탕으로 `backend/.env`를 생성합니다.
- DB 비밀번호를 임의로 생성하며 화면에 출력하지 않습니다.
- 예시 파일의 `POSTGRES_PASSWORD` 항목과 치환 문구를 검사하며, 누락·변경·중복 시 `.env`를 쓰기 전에 오류로 종료합니다.
- 내용이 있는 기존 `.env`는 덮어쓰지 않습니다.
- `.env`는 각자 관리하며 Git에 포함하지 않습니다.

### ② API와 DB 실행

```bash
docker compose up --build -d --wait
docker compose ps
```

`api`와 `postgres`가 모두 **healthy** 상태이면 준비가 끝났습니다. 처음 실행할 때는 이미지 다운로드와 패키지 설치로 시간이 걸릴 수 있습니다.

### ③ 접속 확인

```bash
curl --fail http://127.0.0.1:8000/health
curl --fail http://127.0.0.1:8000/health/db
```


| 주소                                          | 정상 응답 / 역할                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| [서버 상태](http://127.0.0.1:8000/health)       | `200`, `{"status":"ok"}` — API 프로세스 응답 확인                               |
| [DB 연결 상태](http://127.0.0.1:8000/health/db) | `200`, `{"status":"ok","database":"ok"}` — 실제 PostgreSQL에 `SELECT 1` 실행 |
| [Swagger UI](http://127.0.0.1:8000/docs)    | 등록된 API 목록과 요청 테스트                                                      |


`/health/db`가 `503`이면 API는 실행 중이지만 DB 연결에 문제가 있는 상태입니다. 현재 Swagger에는 헬스체크 API만 등록되어 있습니다.

> Windows PowerShell에서는 `python3` 대신 `py -3`, `curl` 대신 `curl.exe`를 사용할 수 있습니다.

### 현재 실행 구조

```mermaid
flowchart LR
    client["브라우저 · curl"] -->|"127.0.0.1:8000"| api
    subgraph docker["각자 노트북의 Docker Compose"]
        api["api · FastAPI"] -->|"postgres:5432"| db[("postgres · PostgreSQL 16")]
        db --> volume["DB 데이터 볼륨"]
    end
```

각 팀원의 DB는 **각자 노트북에 따로 생성**됩니다. 로컬 DB가 팀원의 DB나 AWS DB와 자동으로 공유되지는 않습니다. PostgreSQL의 호스트 포트는 공개하지 않습니다.

팀 아키텍처 그림의 최종 개발 구성에는 호스트에서 실행하는 FastAPI·워커와 Docker의 DB·Redis가 포함됩니다. **이 README의 명령은 현재 구현된 API+DB 컨테이너 구성을 기준으로 합니다.** 실행 방식을 변경할 때 Compose와 이 문서를 함께 갱신합니다.

## 2. 개발 중 사용하는 명령

이 절의 명령은 모두 **저장소 루트** 기준입니다.


| 할 일                | 명령                                        |
| ------------------ | ----------------------------------------- |
| API 코드·의존성 변경 반영   | `docker compose up --build -d --wait api` |
| 전체 실행 / 설정 반영      | `docker compose up --build -d --wait`     |
| 컨테이너 상태 확인         | `docker compose ps`                       |
| API 로그 확인          | `docker compose logs --tail=100 -f api`   |
| DB 로그 확인           | `docker compose logs --tail=100 postgres` |
| 실행 중인 컨테이너 일시 정지   | `docker compose stop`                     |
| 컨테이너 정리, DB 데이터 유지 | `docker compose down`                     |
| 실행 전 Compose 설정 검사 | `docker compose config --quiet`           |


**현재는 코드 자동 반영과 `--reload`가 설정되어 있지 않습니다.** 코드를 수정했으면 위의 API 재빌드 명령으로 반영합니다. 로그 화면은 `Ctrl+C`로 닫아도 컨테이너가 계속 실행됩니다.

`docker compose down`은 DB 볼륨을 남깁니다. `**down -v`는 DB 데이터까지 삭제**하므로 초기화가 필요한 경우에만 사용합니다.

루트 Compose는 `backend/docker-compose.yml`을 포함합니다. `backend/`에서 Compose 명령을 실행해도 동일한 `aidam` 프로젝트를 사용합니다.

## 3. 테스트하기

### 단위 테스트 — Docker와 PostgreSQL 없이 실행 가능

먼저 `**backend/`로 이동**합니다.

```bash
cd backend
```

**macOS / Linux — 최초 1회 설치**

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

**macOS / Linux — 테스트 실행**

```bash
.venv/bin/python -m pytest -q
```

**Windows PowerShell**

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

가상환경을 활성화하지 않아도 위 명령으로 실행할 수 있습니다. 의존성이 변경된 코드를 받으면 설치 명령을 다시 실행합니다.


| 범위           | macOS / Linux 명령 (`backend/` 기준)                          |
| ------------ | --------------------------------------------------------- |
| 전체 테스트       | `.venv/bin/python -m pytest -q`                           |
| 공통 환경 테스트    | `.venv/bin/python -m pytest tests/test_environment.py -q` |
| 특정 테스트 선택    | `.venv/bin/python -m pytest -k database -q`               |
| 실패 원인 자세히 보기 | `.venv/bin/python -m pytest -vv`                          |


현재 `tests/test_environment.py`는 **6개 테스트 케이스**로 다음을 확인합니다.

- DB가 없어도 `/health`가 응답하는지
- DB 상태 API가 쿼리를 실행하는지
- DB 장애 시 내부 접속 정보를 노출하지 않고 `503`을 반환하는지
- 비밀번호 특수문자가 보존되는지
- 빈 비밀번호와 예시 비밀번호를 거부하는지

이 테스트는 SQLite와 실패 상황을 재현하는 테스트 객체를 사용합니다. 실제 PostgreSQL 연결 검증은 아래 절차로 수행합니다.

### 실제 PostgreSQL 연결 확인

**저장소 루트**에서 API와 DB를 실행한 뒤 확인합니다.

```bash
docker compose up --build -d --wait
curl --fail http://127.0.0.1:8000/health/db
```

도메인 테스트는 `tests/<도메인>/test_*.py`에 추가합니다. 성공 케이스와 함께 접근 권한, 입력 오류, DB 변경 등 해당 기능의 중요한 동작을 확인합니다.

## 4. 폴더 구조와 담당 범위

```text
backend/
├── main.py                  # FastAPI 시작점, 헬스체크
├── core/
│   ├── config.py            # 환경변수 로딩 및 검증
│   ├── base.py              # DB 설정 없이 가져올 수 있는 공통 Base
│   └── database.py          # DB 엔진, 세션
├── domains/                 # 도메인별 구현 위치
│   ├── auth/
│   ├── organization/
│   ├── face/
│   ├── media/
│   ├── agents/
│   ├── documents/
│   └── audit/
├── tools/                   # AI 도구 구현 위치
├── prompts/                 # AI 프롬프트 구현 위치
├── tests/                   # 공통 환경 및 도메인별 테스트
├── scripts/                 # 환경변수 생성, Ubuntu 서버 준비
├── alembic/                 # 마이그레이션 예정 위치
├── celery_app.py            # 워커 시작점 예정 위치
├── Dockerfile
├── docker-compose.yml
├── requirements.in          # 직접 사용하는 런타임 의존성
├── requirements.txt         # 설치용 고정 버전
├── requirements-dev.in      # 테스트 등 개발 의존성
├── requirements-dev.txt     # 개발 환경 설치용 고정 버전
└── .env.example             # 공유 가능한 환경변수 예시
```


| 담당      | 도메인                  | 역할                          |
| ------- | -------------------- | --------------------------- |
| A · 엄태은 | `auth` 및 공통 환경       | 로그인·인증, DB 연결·설정·통합         |
| B · 이한나 | `organization`       | 기관·반·원아·학부모 관계, 페르소나·교육계획 등 |
| C · 김동건 | `face`, `media`      | 얼굴 임베딩 관리, 미디어 업로드·메타데이터    |
| D · 정은  | `agents`             | AI 파이프라인, 작업 실행, LLM 연동     |
| E · 한상균 | `documents`, `audit` | 문서 검토·승인·열람, 접근·파기 기록       |


도메인 내부는 `models.py`, `schemas.py`, `router.py`, `service.py`를 기본으로 사용합니다. `**audit`에는 현재 `router.py`와 `schemas.py`가 없습니다.** 도메인별 상세 기능은 확정된 기능·API·ERD 명세를 따릅니다.

## 5. 공통 코드 사용 방법


| 위치           | 책임                          |
| ------------ | --------------------------- |
| `router.py`  | 요청 검증, 서비스 호출, 응답 변환        |
| `schemas.py` | Pydantic 요청·응답 구조           |
| `service.py` | 업무 로직, SQLAlchemy를 통한 DB 접근 |
| `models.py`  | 공통 `Base`를 상속한 ORM 모델       |


```text
router.py → service.py → models.py
                 └→ tools/ · prompts/  (agents 서비스에서 호출)
```

- `router.py`에 업무 로직과 DB 쿼리를 넣지 않습니다.
- `service.py`는 FastAPI의 `Request`, `Response`, `Depends`에 의존하지 않습니다.
- 별도 `repositories/` 계층을 추가하지 않습니다.
- 공통 DB 세션은 동기 방식입니다. 비동기 세션을 혼용해야 한다면 먼저 공통 코드 변경 범위를 논의합니다.

**모델에서 가져올 공통 Base**

```python
from core.base import Base
```

**라우터에서 사용할 DB 세션 의존성**

```python
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from core.database import get_db

DbSession = Annotated[Session, Depends(get_db)]
```

라우터 함수에서 `db: DbSession`으로 받아 서비스에 전달합니다. 서비스는 저장 단위에 맞춰 `commit()`과 필요한 `rollback()`을 처리합니다. `get_db`는 세션을 생성하고 요청이 끝나면 닫으며, 자동 커밋하지 않습니다.

현재 서버 시작 시 테이블을 자동 생성하지 않습니다. Alembic은 아직 설정되지 않았으므로 `alembic upgrade head`를 실행할 수 있는 상태가 아닙니다. 모델·FK 변경은 관련 담당자와 맞추고, 마이그레이션 도입과 함께 반영합니다.

라우터 구현 후에는 `main.py`에 등록해야 Swagger와 API 경로에 노출됩니다. 실제 API 경로는 합의된 API 명세를 따릅니다.

## 6. 환경변수와 의존성 관리

### 환경변수


| 변수                  | 기본 / 예시          | 설명                                 |
| ------------------- | ---------------- | ---------------------------------- |
| `APP_NAME`          | `Aidam API`      | Swagger 등에서 사용하는 앱 이름              |
| `APP_ENV`           | `local`          | `local`, `test`, `production` 중 하나 |
| `API_PORT`          | `8000`           | 호스트에서 접속할 API 포트                   |
| `POSTGRES_HOST`     | `localhost`      | Compose 실행 시 `postgres`로 덮어씀       |
| `POSTGRES_PORT`     | `5432`           | Compose 실행 시 `5432`로 덮어씀           |
| `POSTGRES_USER`     | `postgres`       | DB 사용자                             |
| `POSTGRES_PASSWORD` | 환경변수 생성 스크립트가 설정 | 실제 값은 개인 `.env`에 보관                |
| `POSTGRES_DB`       | `ktc4`           | DB 이름                              |


`APP_ENV` 값만 바꿔도 HTTPS나 인증이 자동 적용되는 것은 아닙니다. 현재 네트워크 노출 범위는 Compose 설정으로 결정합니다.

환경변수를 추가할 때는 필요한 `core/config.py` 필드와 `.env.example`을 함께 수정하고 PR에 사용 목적을 적습니다. `DATABASE_URL` 문자열을 따로 만들지 않고 공통 설정에서 DB 연결 URL을 생성합니다.

### 패키지 추가·변경

`requirements.in`에는 앱이 직접 사용하는 패키지를, `requirements-dev.in`에는 테스트용 패키지를 작성합니다. 이후 `**backend/`에서**, `uv`가 설치된 환경으로 고정 버전 파일을 갱신합니다.

```bash
uv pip compile requirements.in --universal --python-version 3.12 --output-file requirements.txt --no-annotate --no-header
uv pip compile requirements-dev.in --universal --python-version 3.12 --constraint requirements.txt --output-file requirements-dev.txt --no-annotate --no-header
```

관련 `.in`과 `.txt` 변경을 같은 PR에 포함합니다. 런타임 의존성 변경 후에는 API 이미지를 다시 빌드하고, 개발 의존성 변경 후에는 가상환경에 `requirements-dev.txt`를 다시 설치합니다.

## 7. 브랜치와 PR

**팀 내부 작업은 `feature/*` → `develop` PR로 반영합니다.** `develop`에 직접 push하지 않습니다.

공통 환경 설정이 `develop`에 병합된 뒤, 새 작업을 시작할 때의 예시입니다. `feature/auth-login`은 실제 작업에 맞는 이름으로 바꿉니다. 브랜치를 바꾸기 전 진행 중인 변경 사항을 정리합니다.

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/auth-login
```

PR에는 다음 내용을 적습니다.

- 구현한 기능과 관련 API
- 실행한 테스트와 결과
- 새 환경변수·패키지·DB 구조 변경
- 다른 도메인 담당자가 함께 확인해야 할 부분

공통 파일인 `main.py`, `core/`, Compose, 의존성 파일을 변경할 때는 A에게 변경 목적을 공유합니다. 자신의 도메인 외 파일을 바꿔야 하면 해당 담당자와 영향 범위를 맞춥니다.

PR 전에는 관련 테스트, `git diff --check`, `.env` 등 개인 설정 파일이 포함되지 않았는지 확인합니다. 멘토 리뷰용 `develop` → `main` PR은 팀 내부 PR과 별도입니다.

## 8. 자주 발생하는 문제


| 증상                                           | 확인 및 조치                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `Cannot connect to the Docker daemon`        | Docker Desktop/OrbStack을 실행한 뒤 `docker version` 확인                         |
| `.env` 또는 `POSTGRES_PASSWORD` 관련 오류          | `python3 backend/scripts/init_env.py` 실행. 기존 `.env`가 있으면 필요한 변수가 들어 있는지 확인 |
| `8000` 포트 사용 중                               | `backend/.env`의 `API_PORT`를 빈 포트로 바꾸고 Compose 재실행. 접속 URL도 해당 포트 사용        |
| 코드가 바뀌지 않음                                   | API 이미지 재빌드 필요: `docker compose up --build -d --wait api`                  |
| `/health`는 정상, `/health/db`는 `503`           | `docker compose ps`와 API·DB 로그 확인                                          |
| `.env` 비밀번호 변경 후 DB 접속 실패                    | 기존 DB 볼륨에는 이전 비밀번호가 남아 있음. PostgreSQL 계정과 앱 설정을 함께 맞춰야 함                   |
| 호스트의 `localhost:5432`로 DB 접속 불가              | 현재 DB 호스트 포트는 공개하지 않음. API 컨테이너는 `postgres:5432`로 연결                       |
| `ModuleNotFoundError: core` 또는 테스트 import 오류 | `backend/`에서 해당 가상환경의 Python으로 테스트 실행                                      |
| 도메인 테스트 경로에서 `no tests ran`                  | 현재 도메인 폴더에는 `.gitkeep`만 있음. `test_*.py` 작성 후 실행                            |
| 원격 저장소에서 환경 설정 브랜치가 안 보임                     | 로컬 브랜치 생성과 원격 push는 별도. 브랜치가 공유되었는지 확인                                     |


## 9. AWS 서버에서 실행하기

> **로컬 확인과 서버 배포는 별도입니다.** 설치 스크립트와 실행 설정은 준비되어 있지만, 실제 AWS 서버 상태는 접속 후 확인해야 합니다.

제공 환경은 Ubuntu 24.04, 서울 리전의 팀 공용 EC2입니다. 카테캠 포털 → 본인 팀 계정 → 서울 리전 → EC2 → 연결 → Session Manager로 접속합니다.

먼저 서버의 기존 작업 디렉터리·서비스·사용 중인 포트를 확인합니다. 배포할 브랜치의 코드를 합의한 디렉터리에 준비한 다음, **서버의 저장소 루트**에서 실행합니다.

```bash
bash backend/scripts/setup-server.sh
python3 backend/scripts/init_env.py
```

서버의 `backend/.env`에서 `APP_ENV=production`으로 설정한 뒤 실행합니다.

```bash
sudo docker compose up --build -d --wait
sudo docker compose ps
curl --fail http://127.0.0.1:8000/health
curl --fail http://127.0.0.1:8000/health/db
```

`setup-server.sh`는 Docker 공식 Ubuntu 저장소를 사용합니다. 기존 Docker가 있으면 재설치하지 않으며, 충돌 패키지가 발견되면 자동 삭제하지 않고 중단합니다. 기존 Docker에 Compose 플러그인이 없다면 현재 설치 방식에 맞춰 별도로 보완해야 합니다.

원격에 push하지 않은 브랜치는 서버에서 `git clone`으로 가져올 수 없습니다. feature 브랜치를 공유한 뒤 받거나, 비밀 파일을 제외한 배포 아카이브를 전달합니다.

**현재 API는 서버 내부의 `127.0.0.1`에만 열립니다.** 공인 IP 접속, Nginx·HTTPS, 프론트·워커 연결, GitHub Actions 자동 배포는 후속 작업입니다.

