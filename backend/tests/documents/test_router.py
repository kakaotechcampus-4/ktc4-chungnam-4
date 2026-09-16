import os

os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")

from main import app  # noqa: E402

_EXPECTED = {
    ("GET", "/drafts/{draft_id}"),
    ("PATCH", "/drafts/{draft_id}"),
    ("POST", "/drafts/{draft_id}/approve"),
    ("POST", "/drafts/{draft_id}/revoke"),
    ("POST", "/letters/publish"),
    ("GET", "/parent/letters"),
    ("GET", "/parent/letters/{letter_id}"),
}


def test_documents_라우터가_main_app에_등록된다():
    # app.routes는 include_router()로 넣은 라우터를 지연 래퍼(_IncludedRouter)로 감싸서
    # 즉시 펼치지 않는 FastAPI 버전이 있어, 공개 계약인 OpenAPI 스키마로 확인한다.
    schema = app.openapi()
    registered = {
        (method.upper(), path)
        for path, methods in schema["paths"].items()
        for method in methods
        if method.upper() != "HEAD"
    }

    assert _EXPECTED <= registered
