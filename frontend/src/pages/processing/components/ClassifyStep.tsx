import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { faceEmbeddingsQueryOptions } from "@/api/media";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { isPhoto, useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { classifyPhoto } from "@/workers/face/client";
import { ProcessingCard } from "./ProcessingCard";
interface ClassifyStepProps {
  onDone: () => void;
  onCancel: () => void;
}
export function ClassifyStep({ onDone, onCancel }: ClassifyStepProps) {
  const [photos] = useState(() => useUploadQueue.getState().items.filter(isPhoto));
  const [classified, setClassified] = useState(0);
  const { currentClass } = useCurrentClass();
  const { data: embeddings, error } = useQuery({
    ...faceEmbeddingsQueryOptions(currentClass?.class_id ?? ""),
    enabled: currentClass !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    if (!embeddings) return;
    let active = true;
    void (async () => {
      for (let index = 0; index < photos.length; index++) {
        if (!active) return;
        const photo = photos[index]!;
        const result = await classifyPhoto(photo.file, embeddings);
        if (!active) return;
        useUploadQueue.getState().setClassification(photo.client_id, result);
        setClassified(index + 1);
      }
      if (active) onDone();
    })();
    return () => {
      active = false;
    };
  }, [photos, embeddings, onDone]);
  return (
    <ProcessingCard
      stopped={Boolean(error)}
      title={error ? "분류 준비를 멈췄어요" : "아이별로 사진을 모으고 있어요"}
      detail={`${classified} / ${photos.length}장`}
      percent={photos.length ? Math.round((classified / photos.length) * 100) : 0}
      step="classify"
      note="이 기기에서 분석한 뒤 선생님이 결과를 확인해요."
      onCancel={onCancel}
    >
      {error && <p role="alert">{error.message}</p>}
    </ProcessingCard>
  );
}
