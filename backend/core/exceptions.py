class AidamError(Exception):
    """도메인 예외의 공통 조상.

    전역 핸들러가 code·message를 그대로 에러 응답으로 옮깁니다 (backend/CLAUDE.md "스키마와 예외").
    실명·연락처·토큰·임베딩 값을 message나 detail에 넣지 않습니다 (H-4).
    """

    code = "INTERNAL_ERROR"
    status_code = 500

    def __init__(self, message: str, detail: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail


class EmbeddingKeyNotConfigured(AidamError):
    """얼굴 임베딩 암복호화 키가 설정되지 않았거나 요청된 key_ref와 맞지 않습니다."""

    code = "FACE_EMBEDDING_KEY_NOT_CONFIGURED"
    status_code = 500


class EmbeddingDecryptionFailed(AidamError):
    """저장된 임베딩을 복호화하지 못했습니다. 키 불일치 또는 데이터 훼손."""

    code = "FACE_EMBEDDING_DECRYPTION_FAILED"
    status_code = 500


class MediaAssetNotFound(AidamError):
    """알 수 없는 미디어에 귀속 결과를 붙이려 한 경우."""

    code = "MEDIA_ASSET_NOT_FOUND"
    status_code = 404


class InvalidAttributionMethod(AidamError):
    """`method`가 허용된 값이 아닌 경우."""

    code = "MEDIA_INVALID_ATTRIBUTION_METHOD"
    status_code = 400


class DraftVersionConflict(AidamError):
    """초안의 버전이 저장·수정 요청이 기대한 값과 다른 경우.

    그 사이 교사 수정·승인이나 다른 생성 결과가 먼저 반영됐다는 뜻입니다. 최신 문서를
    그대로 두고 이 요청은 반영하지 않습니다 (docs/api/documents.md `DRAFT_VERSION_CONFLICT`).
    """

    code = "DRAFT_VERSION_CONFLICT"
    status_code = 409


class InvalidCredentials(AidamError):
    """이메일이 없거나 비밀번호가 틀렸습니다.

    두 경우를 **구분하지 않습니다** — 구분하면 어떤 이메일이 가입돼 있는지가 샙니다
    (domains/auth/CLAUDE.md). 메시지에 이메일을 넣지 않습니다 (H-4).
    """

    code = "INVALID_CREDENTIALS"
    status_code = 401


class InvalidToken(AidamError):
    """토큰이 위조됐거나 만료됐습니다. 사유를 구분하지 않습니다."""

    code = "INVALID_TOKEN"
    status_code = 401


class JwtSecretNotConfigured(AidamError):
    """JWT_SECRET이 설정되지 않아 토큰을 발급·검증할 수 없습니다."""

    code = "JWT_SECRET_NOT_CONFIGURED"
    status_code = 500
