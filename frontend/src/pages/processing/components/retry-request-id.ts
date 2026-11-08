import { ApiError } from "@/lib/api-client";

/**
 * 생성 요청을 다시 보낼 때 쓸 request_id. 서버가 직접 실패로 답했으면(500 이하) 그 request_id의
 * 작업은 이미 실패로 끝나 같은 값을 보내면 실패한 작업이 그대로 돌아오므로 새로 만듭니다(#304 4-16).
 * 응답을 받지 못했거나 앞단(CloudFront·Caddy)이 502~504로 끊은 경우는 서버가 작업을 만들었을 수
 * 있어 같은 값을 다시 씁니다. 새 값이어도 작업이 돌고 있으면 JOB_ALREADY_RUNNING으로 이어 봅니다.
 */
export function retryRequestId(error: Error | null, current: string) {
  const answeredByServer = error instanceof ApiError && error.status < 502;
  return answeredByServer ? crypto.randomUUID() : current;
}
