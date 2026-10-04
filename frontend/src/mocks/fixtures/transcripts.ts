import type { MediaType, TranscriptSegment, TranscriptStatus } from "@/types/api-draft/media";

import { fixtureId } from "./ids";

// 서버 STT 결과(발화 구간) 목입니다. 문장은 모두 합성이고, 이름은 organization 픽스처의 합성 원아입니다.
// 교사가 바꾼 값(연결·화자·문장·제외)은 이 모듈의 메모리에 둡니다. 새로고침하면 처음 상태입니다.
// 테스트는 resetTranscriptFixtures로 비웁니다.

/** 올린 뒤 STT가 끝날 때까지 걸리는 시간. 테스트는 기다리지 않게 0입니다. */
export const STT_DELAY_MS = import.meta.env.MODE === "test" ? 0 : 3000;

type SegmentTemplate = Pick<TranscriptSegment, "start_time" | "end_time" | "raw_text">;

const TEMPLATES: Record<Exclude<MediaType, "photo">, readonly SegmentTemplate[]> = {
  video: [
    { start_time: 18, end_time: 26, raw_text: "내가 더 높이 쌓아 볼게!" },
    { start_time: 41, end_time: 47, raw_text: "탑이 무너졌네. 다시 해 볼까?" },
  ],
  voice_memo: [
    { start_time: 3, end_time: 11, raw_text: "도윤이가 블록을 색깔별로 나눠 담았어요." },
    { start_time: 15, end_time: 22, raw_text: "하준이가 친구에게 미끄럼틀을 먼저 타라고 했어요." },
  ],
};

export interface TranscriptRecord {
  media_id: string;
  created_at: number;
  /** 시나리오 media.stt-fails면 failed로 끝납니다. */
  fails: boolean;
  segments: TranscriptSegment[];
}

export const transcripts = new Map<string, TranscriptRecord>();
let nextNumber = 1;

/** 처음 조회할 때 만듭니다. 올린 시각 대신 첫 조회 시각부터 STT_DELAY_MS를 셉니다. */
export function transcriptFor(
  mediaId: string,
  type: Exclude<MediaType, "photo">,
  fails: boolean,
): TranscriptRecord {
  const existing = transcripts.get(mediaId);
  if (existing) return existing;
  const record: TranscriptRecord = {
    media_id: mediaId,
    created_at: Date.now(),
    fails,
    segments: TEMPLATES[type].map((template) => ({
      ...template,
      segment_id: fixtureId("segment", nextNumber++),
      media_id: mediaId,
      source: type === "video" ? "video_audio" : "voice_memo",
      text: template.raw_text,
      speaker: null,
      child_ids: [],
      excluded: false,
      reviewed_at: null,
    })),
  };
  transcripts.set(mediaId, record);
  return record;
}

export function transcriptStatus(record: TranscriptRecord): TranscriptStatus {
  if (Date.now() - record.created_at < STT_DELAY_MS) return "pending";
  return record.fails ? "failed" : "done";
}

export function findSegment(segmentId: string) {
  for (const record of transcripts.values()) {
    const segment = record.segments.find((item) => item.segment_id === segmentId);
    if (segment) return { record, segment };
  }
  return null;
}

export function resetTranscriptFixtures() {
  transcripts.clear();
  nextNumber = 1;
}
