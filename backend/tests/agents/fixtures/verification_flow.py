"""백엔드 연결 예제. 외부 호출 없이 전달받은 Critic 응답만 사용한다."""
from tools.contracts import VerificationResult, VerificationStage
from tools.verification.references import validate_references
from tools.verification.target import validate_target
from tools.verification.critic_result import parse_critic_response
from tools.verification.decision import decide


def verify_example(document, evidence_by_id, request, critic_response, regeneration_count=0):
    results = []
    for stage, issues in [
        (VerificationStage.REFERENCES, validate_references(document, evidence_by_id)),
        (VerificationStage.TARGET, validate_target(document, evidence_by_id, request=request)),
    ]:
        results.append(VerificationResult(
            draft_id=document.draft_id, doc_type=document.doc_type, doc_version=document.version,
            stage=stage, passed=not issues, issues=issues,
        ))
    if all(result.passed for result in results):
        results.append(parse_critic_response(critic_response, document))
    return decide(results, regeneration_count, document=document)
