import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { completeUpload, requestUploadUrls, saveChildLinks, uploadFile } from "@/api/media";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import {
  isPhoto,
  uploadTargets,
  useUploadQueue,
  type LocalMedia,
} from "@/features/upload-queue/upload-queue-store";
import type { ChildLinksRequest } from "@/types/api-draft/media";

import { ProcessingCard } from "./ProcessingCard";

interface SendStepProps {
  onDone: () => void;
  onCancel: () => void;
}

/** 교사가 확정한 귀속. 후보에 있던 아이면 얼굴 인식, 교사가 고른 아이면 수동입니다. */
function childLinksBody(item: LocalMedia): ChildLinksRequest {
  // TODO(정은): 영상·음성메모의 수동 귀속은 API 문서 §media에서 (막힘)입니다. 정해지기 전까지는 빈 귀속을 저장해
  //             서버에 미분류로 남깁니다(빈 배열 = 미분류). 귀속을 저장해야 Job이 MEDIA_NOT_READY로 막히지 않습니다.
  if (!isPhoto(item)) return { llm_allowed: false, child_links: [] };
  return {
    llm_allowed: item.llm_allowed,
    child_links: item.assigned_child_ids.map((childId) => {
      const candidate = item.candidates.find((entry) => entry.child_id === childId);
      return candidate
        ? { child_id: childId, method: "face_recognition", confidence_score: candidate.confidence }
        : { child_id: childId, method: "manual", confidence_score: null };
    }),
  };
}

// 가정: 촬영 시각은 EXIF에서 읽어야 하지만 지금은 파일 수정 시각을 씁니다.
function capturedAt(file: File) {
  return new Date(file.lastModified).toISOString();
}

/**
 * upload-urls로 한 번에 주소를 받고, 파일마다 PUT → 완료 통지(ack) → 귀속 저장을 반복합니다(API 문서 §media).
 * "14 / 21개"의 분자는 받은 ack 수입니다. 마지막 귀속 저장이 끝나면 초안 생성으로 넘어갑니다(#60).
 */
export function SendStep({ onDone, onCancel }: SendStepProps) {
  const { currentClass } = useCurrentClass();
  const setUploadState = useUploadQueue((state) => state.setUploadState);
  // 이 단계에 들어온 순간의 확정 목록으로 고정합니다. 전송 중에 목록이 바뀌지 않게 하려는 것입니다.
  const [targets] = useState(() => uploadTargets(useUploadQueue.getState().items));
  const [acked, setAcked] = useState(0);
  const started = useRef(false);

  const send = useMutation({
    mutationFn: async (classId: string) => {
      const { items } = await requestUploadUrls({
        class_id: classId,
        items: targets.map((item) => ({
          client_photo_id: item.client_id,
          type: item.kind,
          content_type: item.file.type,
          size_bytes: item.file.size,
        })),
      });
      for (const [index, item] of targets.entries()) {
        const issued = items[index];
        if (!issued) throw new Error("업로드 URL 응답의 항목 수가 요청과 다릅니다.");
        setUploadState(item.client_id, "전송중");
        // media_id가 이미 있으면 등록이 끝난 파일이라 PUT과 ack를 건너뜁니다.
        let mediaId = issued.media_id;
        if (mediaId === null) {
          await uploadFile(issued, item.file);
          mediaId = (
            await completeUpload({
              client_photo_id: item.client_id,
              class_id: classId,
              type: item.kind,
              captured_at: capturedAt(item.file),
              model_version: isPhoto(item) ? item.model_version : null,
            })
          ).media_id;
        }
        // ack를 받았으니 upload_state를 확인됨으로 둡니다. 원본 삭제는 큐를 비울 때 함께 합니다.
        setUploadState(item.client_id, "확인됨", mediaId);
        setAcked(index + 1);
        await saveChildLinks(mediaId, childLinksBody(item));
      }
    },
    onSuccess: onDone,
  });

  useEffect(() => {
    if (started.current || currentClass === null) return;
    started.current = true;
    if (targets.length === 0) onDone();
    else send.mutate(currentClass.class_id);
  }, [currentClass, targets, send, onDone]);

  const percent = targets.length === 0 ? 100 : Math.round((acked / targets.length) * 100);

  return (
    <ProcessingCard
      title="선택한 자료를 전송하고 있어요"
      detail={`선생님이 확인한 자료만 전송 중 · ${acked} / ${targets.length}개`}
      percent={percent}
      step="send"
      note={"선택한 사진과 기록으로 알림장 초안을 준비해요.\n전송이 끝날 때까지 창을 열어 두세요."}
      onCancel={onCancel}
    >
      {/* TODO(정은): 단계 재시도는 처리 실패 화면에서 붙입니다. */}
      {send.error ? (
        <p role="alert" className="text-body text-coral-ink">
          {send.error.message}
        </p>
      ) : null}
    </ProcessingCard>
  );
}
