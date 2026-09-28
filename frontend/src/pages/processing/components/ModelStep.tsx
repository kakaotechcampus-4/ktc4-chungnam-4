import { useEffect, useState } from "react";

import { useInterval } from "@/lib/use-interval";

import { ProcessingCard } from "./ProcessingCard";

interface ModelStepProps {
  onDone: () => void;
  onCancel: () => void;
}

// 크기는 Figma 문구 그대로입니다("136 / 200 MB").
const MODEL_MB = 200;
// 약 3초에 걸쳐 끝냅니다.
const TICK_MB = 10;
const TICK_MS = 150;

// TODO(정은): 모델 지연 로딩(workers/)이 생기면 실제 내려받은 크기를 보여 줍니다. 지금은 흉내만 냅니다.
export function ModelStep({ onDone, onCancel }: ModelStepProps) {
  const [loadedMb, setLoadedMb] = useState(0);
  const done = loadedMb >= MODEL_MB;

  useInterval(() => setLoadedMb((mb) => Math.min(MODEL_MB, mb + TICK_MB)), done ? null : TICK_MS);
  useEffect(() => {
    if (done) onDone();
  }, [done, onDone]);

  return (
    <ProcessingCard
      title="분석 모델을 준비하고 있어요"
      detail={`처음 한 번만 다운로드해요 · ${loadedMb} / ${MODEL_MB} MB`}
      percent={Math.round((loadedMb / MODEL_MB) * 100)}
      stepIndex={0}
      note={"분석 모델은 이 기기에 저장돼요.\n준비가 끝나면 사진과 발화를 분류합니다."}
      onCancel={onCancel}
    />
  );
}
