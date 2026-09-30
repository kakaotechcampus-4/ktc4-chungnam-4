import { useEffect } from "react";

import { completeUpload, requestUploadUrls, uploadFile } from "@/api/media";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import {
  isPhoto,
  type LocalClip,
  useUploadQueue,
} from "@/features/upload-queue/upload-queue-store";

// 영상·음성 메모를 분류와 함께 먼저 올립니다. 서버 STT가 발화를 만들어야 교사가 분류 확인 단계에서
// 발화를 아이에게 연결할 수 있기 때문입니다(#83 리뷰, 송유진 님 흐름 — 팀 결정 전 제안).
// - 영상·음성은 로컬 검수 대상이 아니고 원래도 업로드 대상입니다(uploadTargets). 올리는 때만 앞당깁니다(H-3).
// - 사진은 여기서 올리지 않습니다. 교사가 확정한 뒤 서버 전송 단계(SendStep)가 올립니다.
// - 귀속 저장(child-links)은 하지 않습니다. 서버 전송 단계가 이미 올라간 파일을 media_id로 알아보고 귀속만 저장합니다.
// 처리 중 화면에서 분류 확인 화면으로 넘어가도 끊기지 않게 컴포넌트 밖에서 돌고, 진행은 업로드 큐에 남깁니다.

// 가정: 촬영 시각은 EXIF에서 읽어야 하지만 지금은 파일 수정 시각을 씁니다(SendStep과 같음).
function capturedAt(file: File) {
  return new Date(file.lastModified).toISOString();
}

function clipsToUpload(): LocalClip[] {
  return useUploadQueue
    .getState()
    .items.filter(
      (item): item is LocalClip =>
        !isPhoto(item) && (item.upload_state === "대기" || item.upload_state === "실패"),
    );
}

/** 큐를 비우거나(취소·전송 끝) 새로 채운 뒤에 끝난 업로드가 다른 배치의 항목을 바꾸지 않게 파일로 대조합니다. */
function setIfStillQueued(clip: LocalClip, state: "확인됨" | "실패", mediaId?: string) {
  const { items, setUploadState } = useUploadQueue.getState();
  if (items.some((item) => item.client_id === clip.client_id && item.file === clip.file)) {
    setUploadState(clip.client_id, state, mediaId);
  }
}

/**
 * 아직 안 올린(또는 실패한) 영상·음성을 올립니다. 도는 중인 파일은 upload_state가 전송중이라 건너뛰므로
 * 여러 번 불러도 됩니다.
 */
export async function startClipUploads(classId: string) {
  const clips = clipsToUpload();
  if (clips.length === 0) return;
  // 기다리기 전에 전송중으로 바꿔 두어 동시에 부른 쪽이 같은 파일을 또 올리지 않게 합니다.
  const { setUploadState } = useUploadQueue.getState();
  for (const clip of clips) setUploadState(clip.client_id, "전송중");
  let current = 0;
  try {
    const { items } = await requestUploadUrls({
      class_id: classId,
      items: clips.map((clip) => ({
        client_photo_id: clip.client_id,
        type: clip.kind,
        content_type: clip.file.type,
        size_bytes: clip.file.size,
      })),
    });
    for (const [index, clip] of clips.entries()) {
      current = index;
      const issued = items[index];
      if (!issued) throw new Error("업로드 URL 응답의 항목 수가 요청과 다릅니다.");
      let mediaId = issued.media_id;
      if (mediaId === null) {
        await uploadFile(issued, clip.file);
        mediaId = (
          await completeUpload({
            client_photo_id: clip.client_id,
            class_id: classId,
            type: clip.kind,
            captured_at: capturedAt(clip.file),
            model_version: null,
          })
        ).media_id;
      }
      setIfStillQueued(clip, "확인됨", mediaId);
    }
  } catch {
    // 실패는 정상 흐름의 일부입니다. 남은 파일을 실패로 두고, 화면의 "다시 올리기"나 서버 전송 단계가 다시 올립니다.
    for (const clip of clips.slice(current)) setIfStillQueued(clip, "실패");
  }
}

/** 현재 반을 알게 되면 영상·음성 업로드를 시작합니다. 처리 중(분류) 화면과 분류 결과 화면이 부릅니다. */
export function useClipUploads() {
  const { currentClass } = useCurrentClass();
  const classId = currentClass?.class_id;
  const hasPendingClips = useUploadQueue((state) =>
    state.items.some((item) => !isPhoto(item) && item.upload_state === "대기"),
  );
  useEffect(() => {
    if (classId && hasPendingClips) void startClipUploads(classId);
  }, [classId, hasPendingClips]);
  return {
    retry: () => {
      if (classId) void startClipUploads(classId);
    },
  };
}
