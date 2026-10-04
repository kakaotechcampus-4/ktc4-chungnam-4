import { useQueries } from "@tanstack/react-query";

import { transcriptQueryOptions } from "@/api/media";
import { useClipUploads } from "@/features/classify/clip-upload";
import {
  isPhoto,
  type LocalClip,
  useUploadQueue,
} from "@/features/upload-queue/upload-queue-store";
import type { TranscriptSegment } from "@/types/api-draft/media";

// 업로드 큐의 영상·음성마다 서버 STT 결과(발화 구간)를 받습니다. 분류 결과·수동 분류·아이별 하루 확인이 같이 씁니다.
// 발화는 서버 데이터라 업로드 큐에 복사하지 않고 TanStack Query 캐시만 봅니다(frontend/CLAUDE.md §상태 관리).

export type ClipTranscriptState =
  "uploading" | "upload_failed" | "transcribing" | "done" | "stt_failed" | "error";

export interface ClipTranscript {
  clip: LocalClip;
  state: ClipTranscriptState;
  error: Error | null;
}

/** 화면에 보여 줄 발화 하나. 어느 파일의 몇 번째인지와 촬영 시각을 붙입니다. */
export interface QueueSegment {
  segment: TranscriptSegment;
  clip: LocalClip;
  /** 전체 발화 중 순번(1부터). "발화 02"처럼 씁니다. */
  number: number;
  /** 파일 촬영 시각 + 시작 초(UTC ISO). 촬영 시각은 파일 수정 시각으로 대신합니다(가정). */
  spokenAt: string;
}

/**
 * 발화를 보는 화면은 이 훅 하나만 부르면 됩니다. 아직 안 올린 영상·음성이 있으면 여기서 올리기 시작합니다
 * (주소로 바로 들어오거나 새로 채운 큐도 처리 중 화면을 거치지 않고 이어지게).
 */
export function useQueueTranscripts() {
  const { retry } = useClipUploads();
  const items = useUploadQueue((state) => state.items);
  const clips = items.filter((item): item is LocalClip => !isPhoto(item));
  // 올라간 파일만 조회합니다. 올리기 전 파일끼리 같은 키로 겹치지 않게 합니다.
  const uploaded = clips.filter((clip) => clip.server_media_id !== null);
  const queried = useQueries({
    queries: uploaded.map((clip) => transcriptQueryOptions(clip.server_media_id ?? "")),
  });
  const results = clips.map((clip) => {
    const at = uploaded.indexOf(clip);
    return at === -1 ? undefined : queried[at];
  });

  const perClip: ClipTranscript[] = clips.map((clip, index) => {
    const result = results[index];
    if (clip.upload_state === "실패") return { clip, state: "upload_failed", error: null };
    if (!result) return { clip, state: "uploading", error: null };
    if (result.error) return { clip, state: "error", error: result.error };
    const status = result.data?.transcript_status;
    if (status === "done") return { clip, state: "done", error: null };
    if (status === "failed") return { clip, state: "stt_failed", error: null };
    return { clip, state: "transcribing", error: null };
  });

  // 순번은 파일 순서대로 이어 붙입니다("발화 01"부터).
  const segments: QueueSegment[] = clips
    .flatMap((clip, index) =>
      (results[index]?.data?.items ?? []).map((segment) => ({ segment, clip })),
    )
    .map(({ segment, clip }, index) => ({
      segment,
      clip,
      number: index + 1,
      spokenAt: new Date(clip.file.lastModified + segment.start_time * 1000).toISOString(),
    }));

  return {
    clips: perClip,
    segments,
    /** 업로드·STT가 아직 도는 중인 파일 수. 0이 되어야 발화 확인을 마칠 수 있습니다. */
    workingCount: perClip.filter((c) => c.state === "uploading" || c.state === "transcribing")
      .length,
    failedCount: perClip.filter((c) => c.state === "upload_failed" || c.state === "stt_failed")
      .length,
    error: perClip.find((c) => c.error)?.error ?? null,
    refetch: () => {
      for (const result of queried) void result.refetch();
    },
    /** 실패한 영상·음성을 다시 올립니다. */
    retryUpload: retry,
  };
}

/** 교사가 아직 연결하거나 빼지 않은 발화 */
export function isPendingSegment(segment: TranscriptSegment) {
  return !segment.excluded && segment.child_ids.length === 0;
}
