import { useEffect, useState } from "react";
import { prepareFaceModels } from "@/workers/face/client";
import { ProcessingCard } from "./ProcessingCard";
interface ModelStepProps {
  onDone: () => void;
  onCancel: () => void;
}
export function ModelStep({ onDone, onCancel }: ModelStepProps) {
  const [error, setError] = useState<string | null>(null);
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
  }, [onDone]);
  return (
    <ProcessingCard
      stopped={Boolean(error)}
      title={error ? "모델 준비를 멈췄어요" : "분석 모델을 준비하고 있어요"}
      detail="얼굴 분석은 이 기기에서 실행해요"
      percent={0}
      step="model"
      note="다운로드가 완료되면 실제 사진 분류를 시작해요."
      onCancel={onCancel}
    >
      {error && <p role="alert">{error}</p>}
    </ProcessingCard>
  );
}
