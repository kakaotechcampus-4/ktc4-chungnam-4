"""검사 누락·다른 초안의 결과를 차단하고 다음 행동만 반환한다.

RETRY_CRITIC은 백엔드의 별도 제한된 재검사 정책으로 처리한다.
재검사 상한 소진 시 백엔드는 교사 확인으로 전달하며 문서 재생성 횟수는 늘리지 않는다.
"""
from tools.contracts import (
    Decision,
    DecisionResult,
    DraftDocument,
    VerificationCheckType,
    VerificationResult,
    VerificationStage,
)

MAX_REGENERATIONS = 2


def decide(results: list[VerificationResult], regeneration_count: int,
           max_regenerations: int = MAX_REGENERATIONS, *,
           document: DraftDocument) -> DecisionResult:
    if type(regeneration_count) is not int or regeneration_count < 0:
        raise ValueError("regeneration_count must be a non-negative integer")
    if type(max_regenerations) is not int or not 0 <= max_regenerations <= MAX_REGENERATIONS:
        raise ValueError("max_regenerations must be between 0 and 2")
    if regeneration_count > max_regenerations:
        raise ValueError("regeneration_count exceeds limit")

    def review(reason):
        return DecisionResult(decision=Decision.NEEDS_TEACHER_REVIEW, reason=reason)

    stages = [result.stage for result in results]
    if len(stages) != len(set(stages)) or any(
        (r.draft_id, r.doc_type, r.doc_version) !=
        (document.draft_id, document.doc_type, document.version) for r in results
    ):
        return review("중복 검사 또는 다른 초안·버전의 검증 결과입니다.")
    code_stages = {VerificationStage.REFERENCES, VerificationStage.TARGET}
    if not code_stages.issubset(stages):
        return review("필수 코드 검사가 누락되었습니다.")
    failed = [r for r in results if not r.passed]
    # 코드 실패로 Critic을 생략하는 흐름은 허용하지만, 통과에는 Critic이 필수다.
    if not failed and VerificationStage.CRITIC not in stages:
        return review("Critic 검사가 누락되었습니다.")
    issues = [issue for r in failed for issue in r.issues]
    if failed and not issues:
        return review("검증 실패 사유가 누락되었습니다.")
    if any(i.check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR for i in issues):
        return DecisionResult(decision=Decision.RETRY_CRITIC,
                              reason="Critic 응답 오류로 별도 재검사가 필요합니다.", issues=issues)
    if failed:
        if regeneration_count < max_regenerations:
            return DecisionResult(decision=Decision.REGENERATE,
                                  reason="검증에 실패하여 해당 문서 재생성이 필요합니다.", issues=issues)
        return DecisionResult(decision=Decision.NEEDS_TEACHER_REVIEW,
                              reason="재생성 상한에 도달했습니다.", issues=issues)
    return DecisionResult(decision=Decision.PASS, reason="모든 검증을 통과했습니다.")
