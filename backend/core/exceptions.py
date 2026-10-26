from typing import Any


class AidamError(Exception):
    """도메인 예외의 공통 조상.

    전역 핸들러가 code·message를 그대로 에러 응답으로 옮깁니다 (backend/CLAUDE.md "스키마와 예외").
    실명·연락처·토큰·임베딩 값을 message나 detail에 넣지 않습니다 (H-4).
    """

    code = "INTERNAL_ERROR"
    status_code = 500

    # detail은 문자열 설명이거나, FE가 이어서 쓸 값(예: `{"job_id": ...}`)을 담은 객체입니다.
    def __init__(self, message: str, detail: str | dict[str, Any] | None = None) -> None:
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


class FaceConsentRequired(AidamError):
    """③ 얼굴특징정보처리 동의가 없는 원아의 얼굴 정보를 등록하려 했습니다 (H-3, FR-28).

    코드 이름은 face 담당이 정한 값입니다(docs/api/media-face.md §상의 필요 4, 팀 공지 전).
    """

    code = "FACE_CONSENT_REQUIRED"
    status_code = 403


class MediaAssetNotFound(AidamError):
    """알 수 없는 미디어에 귀속 결과를 붙이려 한 경우."""

    code = "MEDIA_ASSET_NOT_FOUND"
    status_code = 404


class InvalidAttributionMethod(AidamError):
    """`method`가 허용된 값이 아닌 경우."""

    code = "INVALID_ATTRIBUTION_METHOD"
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


class StorageNotConfigured(AidamError):
    """S3 버킷 설정(`S3_BUCKET`)이나 AWS 자격증명이 없어 업로드 URL을 만들 수 없습니다."""

    code = "STORAGE_NOT_CONFIGURED"
    status_code = 500


class ClientPhotoIdConflict(AidamError):
    """같은 `client_photo_id`가 다른 반의 업로드로 이미 쓰였습니다 (docs/api/media-face.md)."""

    code = "CLIENT_PHOTO_ID_CONFLICT"
    status_code = 409


class MediaTypeNotAllowed(AidamError):
    """허용하지 않은 형식이거나 `type`(photo/video/voice_memo)과 맞지 않는 형식입니다."""

    code = "MEDIA_TYPE_NOT_ALLOWED"
    status_code = 400


class UploadBatchTooLarge(AidamError):
    """한 요청의 파일 수나 파일 하나의 크기가 상한을 넘었습니다 (docs/api/media-face.md)."""

    code = "UPLOAD_BATCH_TOO_LARGE"
    status_code = 400


class MediaUploadNotFound(AidamError):
    """완료 통지를 받았지만 S3에 객체가 없거나, 서버가 URL을 내준 적이 없는 파일입니다.

    업로드가 덜 끝났거나 URL이 만료된 경우입니다. FE는 URL을 다시 받아 올립니다.
    """

    code = "MEDIA_UPLOAD_NOT_FOUND"
    status_code = 409


class MediaDeleted(AidamError):
    """보관 기간이 끝나 파기된 미디어입니다. 파일이 없어 다시 보여 줄 수 없습니다."""

    code = "MEDIA_DELETED"
    status_code = 409


class DuplicateChildLink(AidamError):
    """같은 원아가 귀속 목록에 두 번 있습니다. FE 버그를 숨기지 않으려고 거절합니다."""

    code = "DUPLICATE_CHILD_LINK"
    status_code = 400


class MediaUploadMismatch(AidamError):
    """S3에 올라간 파일의 크기·형식·앞부분이 URL을 받을 때 선언한 것과 다릅니다.

    URL을 다시 받아 같은 파일을 올리면 됩니다(발급할 때마다 새 경로라 이전 파일과 겹치지 않습니다).
    """

    code = "MEDIA_UPLOAD_MISMATCH"
    status_code = 400


class Unauthenticated(AidamError):
    """로그인 쿠키가 없거나, 토큰이 무효이거나, 계정이 사라졌습니다.

    세 경우를 구분하지 않습니다. FE는 이 코드를 받으면 로그인 화면으로 보냅니다
    (테크스펙 §공통 API 규약 공통 에러 코드).
    """

    code = "UNAUTHENTICATED"
    status_code = 401


class RoleNotAllowed(AidamError):
    """교사 경로에 학부모가(또는 반대로) 들어왔습니다."""

    code = "ROLE_NOT_ALLOWED"
    status_code = 403


class ClassNotFound(AidamError):
    """없는 반에 접근하려 한 경우."""

    code = "CLASS_NOT_FOUND"
    status_code = 404


class ClassAccessDenied(AidamError):
    """다른 어린이집의 반에 접근하려 한 경우.

    같은 어린이집(center) 소속 교사는 모든 반에 접근합니다 (FR-25, 담당교사 개념 폐지).
    """

    code = "CLASS_ACCESS_DENIED"
    status_code = 403


class ChildNotFound(AidamError):
    """없는 원아에 접근하려 한 경우."""

    code = "CHILD_NOT_FOUND"
    status_code = 404


class ChildAccessDenied(AidamError):
    """다른 어린이집의 원아에 접근하려 한 경우."""

    code = "CHILD_ACCESS_DENIED"
    status_code = 403


class ChildNotInClass(AidamError):
    """그 반 원아가 아닌 원아를 반의 미디어·기록에 연결하려 한 경우."""

    code = "CHILD_NOT_IN_CLASS"
    status_code = 400


class InvalidRecordDate(AidamError):
    """초안 생성 날짜가 오늘(KST)보다 뒤입니다 (docs/api/agents.md)."""

    code = "INVALID_RECORD_DATE"
    status_code = 400


class MediaNotReady(AidamError):
    """보낸 미디어 중 완료 통지·귀속 저장 전이거나 이 반·날짜의 자료가 아닌 것이 있습니다.

    해당 ID는 `detail.media_ids`에 담습니다 (docs/api/agents.md `MEDIA_NOT_READY`).
    """

    code = "MEDIA_NOT_READY"
    status_code = 409


class NoTargetChildren(AidamError):
    """그 날짜에 귀속된 자료가 있는 원아가 없어 초안을 만들 대상이 없습니다."""

    code = "NO_TARGET_CHILDREN"
    status_code = 409


class JobAlreadyRunning(AidamError):
    """같은 반·날짜에 진행 중인 초안 생성 작업이 있습니다.

    FE는 `detail.job_id`로 그 작업을 이어서 폴링합니다 (docs/api/agents.md).
    """

    code = "JOB_ALREADY_RUNNING"
    status_code = 409


class JobNotFound(AidamError):
    """없는 초안 생성 작업을 조회했습니다."""

    code = "JOB_NOT_FOUND"
    status_code = 404


class CenterNotFound(AidamError):
    """가입 코드와 일치하는 어린이집이 없는 경우 (FR-23)."""

    code = "CENTER_NOT_FOUND"
    status_code = 404
