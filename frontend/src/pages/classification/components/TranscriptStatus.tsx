import { Button } from "@/components/ui/button";

interface TranscriptStatusProps {
  /** 올리는 중이거나 서버 STT가 도는 영상·음성 수 */
  workingCount: number;
  /** 올리기나 STT가 실패한 영상·음성 수 */
  failedCount: number;
  /** 발화 목록 조회 실패 */
  error: Error | null;
  onRetryUpload: () => void;
  onRefetch: () => void;
}

// 영상·음성의 발화 준비 상태(Figma에 없는 줄). 발화가 다 와야 분류 확인을 마칠 수 있어서 이유를 보여 줍니다.
export function TranscriptStatus({
  workingCount,
  failedCount,
  error,
  onRetryUpload,
  onRefetch,
}: TranscriptStatusProps) {
  if (error) {
    return (
      <div
        role="alert"
        className="mb-3 flex items-center justify-between gap-4 rounded-md bg-coral-soft px-4 py-3 text-body text-coral-ink"
      >
        <p>발화를 불러오지 못했어요. ({error.message})</p>
        <Button variant="outline" size="sm" onClick={onRefetch}>
          다시 불러오기
        </Button>
      </div>
    );
  }
  if (workingCount > 0) {
    return (
      <p role="status" className="mb-3 rounded-md bg-tint-2 px-4 py-3 text-body text-ink">
        영상·음성 {workingCount}개를 글로 바꾸고 있어요. 끝나면 발화를 아이에게 연결할 수 있어요.
      </p>
    );
  }
  if (failedCount > 0) {
    return (
      <div
        role="status"
        className="mb-3 flex items-center justify-between gap-4 rounded-md bg-tint-2 px-4 py-3 text-body text-ink"
      >
        <p>
          영상·음성 {failedCount}개에서 발화를 얻지 못했어요. 발화 없이 계속할 수 있고, 파일은
          전송할 때 다시 올려요.
        </p>
        <Button variant="outline" size="sm" onClick={onRetryUpload}>
          다시 올리기
        </Button>
      </div>
    );
  }
  return null;
}
