import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { faceEmbeddingsQueryOptions } from "@/api/media";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { useClipUploads } from "@/features/classify/clip-upload";
import { isPhoto, useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { useInterval } from "@/lib/use-interval";

import { classifySafely, FAKE_MODEL_VERSION, fakeClassify } from "../fake-classify";
import { ProcessingCard } from "./ProcessingCard";

interface ClassifyStepProps {
  onDone: () => void;
  onCancel: () => void;
}

// 가짜 분류라 사진 수와 상관없이 약 3초에 걸쳐 끝냅니다. 진행이 눈에 보이게 하려는 것입니다.
const TICK_MS = 150;
const TOTAL_TICKS = 20;

// 사진만 분류합니다. 영상·음성 메모는 로컬 처리 대상이 아닙니다(frontend/CLAUDE.md §온디바이스).
// 반 임베딩은 분류를 시작할 때 한 번 받습니다(API 문서 §face).
// 영상·음성은 분류와 동시에 먼저 올려 서버 STT를 돌립니다(④ 김동건, #83 리뷰). 화면을 떠나도 업로드는 이어집니다.
export function ClassifyStep({ onDone, onCancel }: ClassifyStepProps) {
  useClipUploads();
  const items = useUploadQueue((state) => state.items);
  const setClassification = useUploadQueue((state) => state.setClassification);
  const photos = useMemo(() => items.filter(isPhoto), [items]);
  const { currentClass } = useCurrentClass();
  const { data: embeddings, error } = useQuery({
    ...faceEmbeddingsQueryOptions(currentClass?.class_id ?? ""),
    enabled: currentClass !== null,
  });
  // 모델 버전이 다른 원아는 자동 분류 후보에서 빼고 수동 분류로 보냅니다(제안).
  const childIds = useMemo(
    () =>
      (embeddings ?? [])
        .filter((item) => item.model_version === FAKE_MODEL_VERSION)
        .map((item) => item.child_id),
    [embeddings],
  );
  const [tick, setTick] = useState(0);
  const [classified, setClassified] = useState(0);
  const done = embeddings !== undefined && tick >= TOTAL_TICKS;

  useInterval(
    () => {
      const next = tick + 1;
      const end = Math.min(photos.length, Math.ceil((photos.length * next) / TOTAL_TICKS));
      for (let index = classified; index < end; index += 1) {
        const photo = photos[index];
        if (photo) {
          setClassification(
            photo.client_id,
            classifySafely(() => fakeClassify(index, childIds)),
          );
        }
      }
      setClassified(end);
      setTick(next);
    },
    // 임베딩이 와야 시작합니다. 임베딩 요청이 실패하면 빈 목록으로 대신하지 않고 멈춥니다(API 문서 §face).
    done || embeddings === undefined ? null : TICK_MS,
  );
  useEffect(() => {
    if (done) onDone();
  }, [done, onDone]);

  const percent = Math.round((tick / TOTAL_TICKS) * 100);

  return (
    <ProcessingCard
      title="아이별로 자료를 모으고 있어요"
      detail={`이 기기에서 안전하게 분석 중 · ${classified} / ${photos.length}장`}
      percent={percent}
      stepIndex={1}
      note={
        "원본 사진은 아직 서버로 보내지 않아요.\n분류가 끝나면 선생님이 결과를 확인할 수 있어요."
      }
      onCancel={onCancel}
    >
      {/* TODO(정은): 단계 재시도는 처리 실패 화면에서 붙입니다. */}
      {error ? (
        <p role="alert" className="text-body text-coral-ink">
          {error.message}
        </p>
      ) : null}
    </ProcessingCard>
  );
}
