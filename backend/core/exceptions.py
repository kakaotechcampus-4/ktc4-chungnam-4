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
