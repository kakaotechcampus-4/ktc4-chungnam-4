import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  mediaKeys,
  type TranscriptSegmentInput,
  type TranscriptView,
  updateTranscriptSegment,
} from "@/api/media";

/** 발화 연결·제외·수정. 저장되면 그 파일의 발화 목록 캐시를 서버 응답으로 바꿉니다. */
export function useUpdateSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ segmentId, body }: { segmentId: string; body: TranscriptSegmentInput }) =>
      updateTranscriptSegment(segmentId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<TranscriptView>(
        mediaKeys.transcript(saved.media_id),
        (prev) =>
          prev && {
            ...prev,
            items: prev.items.map((item) => (item.segment_id === saved.segment_id ? saved : item)),
          },
      );
    },
  });
}
