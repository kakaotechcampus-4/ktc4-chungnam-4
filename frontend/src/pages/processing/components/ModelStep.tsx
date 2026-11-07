import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { prepareFaceModels } from "@/workers/face/client";
import { FACE_MODEL_BYTES } from "@/workers/face/model-manifest";

import { ProcessingCard } from "./ProcessingCard";
interface ModelStepProps {
  onDone: () => void;
  onCancel: () => void;
}

// 내려받는 양은 manifest가 알려 줍니다(생성 파일). 손으로 적으면 모델을 바꿀 때 같이 안
// 고쳐집니다 — 실제로 Figma 문구 "200 MB"가 iris를 뺀 뒤에도 남아 9MB를 받으면서 200MB
// 눈금을 보여 줬습니다. HUMAN이 진행률을 주지 않아 눈금 대신 크기만 알립니다.
const MODEL_MB = Math.max(1, Math.round(FACE_MODEL_BYTES / 1024 / 1024));
export function ModelStep({ onDone, onCancel }: ModelStepProps) {
  const [error, setError] = useState<string | null>(null);
  // 다시 시도하면 값이 바뀌어 준비를 처음부터 다시 합니다. 실패한 worker는 client가 이미 버렸습니다.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    prepareFaceModels()
      .then(() => {
        if (active) onDone();
      })
      .catch(() => {
        if (active)
          setError(
            "분석 모델을 준비하지 못했어요. 네트워크와 브라우저를 확인한 뒤 다시 시도해 주세요.",
          );
      });
    return () => {
      active = false;
    };
  }, [onDone, attempt]);
  return (
    <ProcessingCard
      stopped={Boolean(error)}
      title={error ? "모델 준비를 멈췄어요" : "분석 모델을 준비하고 있어요"}
      detail={`얼굴 분석은 이 기기에서 실행해요 · 약 ${String(MODEL_MB)}MB, 처음 한 번만 받아요`}
      percent={0}
      step="model"
      note="다운로드가 완료되면 실제 사진 분류를 시작해요."
      onCancel={onCancel}
    >
      {error && (
        <div role="alert" className="space-y-3">
          <p>{error}</p>
          {/* 취소하면 고른 사진과 날짜가 지워지므로, 이 단계만 다시 돌리는 길을 둡니다(#231 리뷰). */}
          <Button
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            모델 준비 다시 시도
          </Button>
        </div>
      )}
    </ProcessingCard>
  );
}
