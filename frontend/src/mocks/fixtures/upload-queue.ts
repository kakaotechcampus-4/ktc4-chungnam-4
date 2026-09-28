import type { LocalMedia, LocalPhoto } from "@/features/upload-queue/upload-queue-store";

import { MODEL_VERSION } from "./media";
import { fixtureId } from "./ids";
import { SUNSHINE_CHILDREN } from "./organization";

// 오늘 불러온 자료(브라우저 업로드 큐)의 목입니다. 서버 응답이 아니라 화면 사이에서 넘기는 로컬 상태입니다.
// 파일은 내용 없는 합성 바이트입니다. 원아 사진·영상·음성을 쓰지 않습니다(루트 CLAUDE.md §Git).

function syntheticFile(name: string, type: string, sizeBytes: number) {
  return new File([new Uint8Array(sizeBytes)], name, {
    type,
    lastModified: Date.UTC(2026, 8, 15, 1, 10),
  });
}

const [doyun, seoa, hajun] = SUNSHINE_CHILDREN;

function photo(n: number, childIds: readonly string[], unidentified = false): LocalPhoto {
  return {
    client_id: fixtureId("clientPhoto", n),
    file: syntheticFile(`IMG_48${20 + n}.JPG`, "image/jpeg", 2_800_000 + n * 100_000),
    kind: "photo",
    import_progress: 100,
    upload_state: "대기",
    server_media_id: null,
    model_version: MODEL_VERSION,
    classify_state: childIds.length > 0 ? "classified" : "unclassified",
    candidates: childIds.map((childId) => ({ child_id: childId, confidence: 0.92 })),
    has_unidentified_face: unidentified,
    review_state: "미검수",
    assigned_child_ids: [],
    excluded_reason: null,
    llm_allowed: false,
  };
}

/** 분류까지 끝나고 교사 확인 전인 큐. 얼굴 분류 · 결과 확인(④) 화면을 만들 때 씁니다. */
export function classifiedQueue(): LocalMedia[] {
  return [
    photo(1, [doyun!.child_id]),
    photo(2, [seoa!.child_id]),
    photo(3, [doyun!.child_id, hajun!.child_id]),
    photo(4, [hajun!.child_id]),
    // 얼굴을 못 찾은 사진입니다. 교사 수동 분류로 갑니다(FR-14).
    photo(5, [], true),
    {
      client_id: fixtureId("clientPhoto", 6),
      file: syntheticFile("VID_0113.MOV", "video/quicktime", 8_240_000),
      kind: "video",
      import_progress: 100,
      upload_state: "대기",
      server_media_id: null,
    },
    {
      client_id: fixtureId("clientPhoto", 7),
      file: syntheticFile("REC_1035.M4A", "audio/mp4", 610_000),
      kind: "voice_memo",
      import_progress: 100,
      upload_state: "대기",
      server_media_id: null,
    },
  ];
}

/**
 * 교사 확인까지 끝난 큐. 자동 분류된 사진은 후보대로 확정했고, 미분류 사진은 확인하지 않은 채 남아 있습니다.
 * 그래서 서버 전송에는 사진 4장과 영상·녹음 2개, 모두 6개가 갑니다(H-3).
 */
export function confirmedQueue(): LocalMedia[] {
  return classifiedQueue().map((item) =>
    item.kind === "photo" && item.classify_state === "classified"
      ? {
          ...item,
          review_state: "확정",
          assigned_child_ids: item.candidates.map((candidate) => candidate.child_id),
          llm_allowed: true,
        }
      : item,
  );
}
