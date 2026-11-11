import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

interface TranscriptStatusProps {
  /** 올리는 중이거나 서버 STT가 도는 영상·음성 수 */
  workingCount: number;
  /** 올리지 못한 영상·음성 수 — "다시 올리기"로 복구됩니다. */
  uploadFailedCount: number;
  /** 올라갔지만 STT가 실패한 영상·음성 수 — 다시 올려도 STT는 다시 돌지 않아 버튼을 두지 않습니다. */
  sttFailedCount: number;
  /** 발화 목록 조회 실패 */
  error: Error | null;
  onRetryUpload: () => void;
  onRefetch: () => void;
}

// 영상·음성의 발화 준비 상태(Figma에 없는 줄). 발화가 다 와야 분류 확인을 마칠 수 있어서 이유를 보여 줍니다.
export function TranscriptStatus({
  workingCount,
  uploadFailedCount,
  sttFailedCount,
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
    // 폴링으로 숫자가 바뀌다 꺼지는 줄이라 등장 효과는 두지 않고, 도는 표시로 아직 진행 중임만 알립니다.
    return (
      <p
        role="status"
        className="mb-3 flex items-center gap-2 rounded-md bg-tint-2 px-4 py-3 text-body text-ink"
      >
        <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
        영상·음성 {workingCount}개를 글로 바꾸고 있어요. 끝나면 발화를 아이에게 연결할 수 있어요.
      </p>
    );
  }
  if (uploadFailedCount > 0) {
    // 올리지 못한 파일은 다시 올리면 복구됩니다. STT 실패는 따로 알립니다.
    return (
      <div
        role="status"
        className="mb-3 flex items-center justify-between gap-4 rounded-md bg-tint-2 px-4 py-3 text-body text-ink"
      >
        <p>
          영상·음성 {uploadFailedCount}개를 올리지 못했어요. 다시 올리면 발화를 얻을 수 있고, 발화
          없이 계속할 수도 있어요.
          {sttFailedCount > 0
            ? ` 올라간 ${sttFailedCount}개는 발화를 얻지 못해 발화 없이 이어가요.`
            : null}
        </p>
        <Button variant="outline" size="sm" onClick={onRetryUpload}>
          다시 올리기
        </Button>
      </div>
    );
  }
  if (sttFailedCount > 0) {
    // 파일은 이미 올라가 있어 다시 올려도 요청이 나가지 않습니다. 재시도 버튼 없이 계속하는 길만 안내합니다.
    return (
      <p role="status" className="mb-3 rounded-md bg-tint-2 px-4 py-3 text-body text-ink">
        영상·음성 {sttFailedCount}개에서 발화를 얻지 못했어요. 발화 없이 계속할 수 있어요.
      </p>
    );
  }
  return null;
}
