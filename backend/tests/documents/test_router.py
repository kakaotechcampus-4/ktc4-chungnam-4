import os

os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")

from main import app

# 경로는 docs/api/documents.md와 같다. 베이스 경로 /api/v1은 main.py가 붙인다.
_EXPECTED = {
    ("GET", "/api/v1/drafts/{draft_id}"),
    ("PATCH", "/api/v1/drafts/{draft_id}"),
    ("POST", "/api/v1/drafts/{draft_id}/approve"),
    ("POST", "/api/v1/drafts/{draft_id}/revoke"),
    ("POST", "/api/v1/publications"),
    ("GET", "/api/v1/children/{child_id}/parent-notes"),
    ("GET", "/api/v1/parent-notes/{parent_note_id}"),
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


def test_베이스_경로_없는_예전_documents_경로는_남지_않는다():
    # /api/v1 없이 등록되면 CloudFront가 /api/*만 서버로 보내서 화면에서 닿지 않는다 (#160).
    paths = app.openapi()["paths"]

    assert not [path for path in paths if path.startswith(("/drafts", "/letters", "/parent"))]
