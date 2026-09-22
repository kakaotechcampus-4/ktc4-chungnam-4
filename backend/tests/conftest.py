"""테스트 수집이 개발자의 `.env`나 실행 중인 PostgreSQL에 의존하지 않게 합니다.

`core.config.Settings`는 `POSTGRES_PASSWORD`를 필수로 요구하고, `celery_app`
처럼 임포트 시점에 `get_settings()`를 호출하는 모듈이 있습니다. `.env`가 없는
환경(CI, 저장소를 막 받은 팀원)에서는 테스트를 실행하기도 전에 수집 단계에서
실패합니다.

pytest는 테스트 모듈보다 `conftest.py`를 먼저 읽으므로 여기서 값을 채웁니다.
DB에 실제로 연결하지는 않으며, 이미 환경변수가 있으면 덮어쓰지 않습니다.
"""

import os

os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")
