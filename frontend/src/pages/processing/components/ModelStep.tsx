import { useEffect, useState } from "react";

import { useInterval } from "@/lib/use-interval";
import { FACE_MODEL_BYTES } from "@/workers/face/model-manifest";

import { ProcessingCard } from "./ProcessingCard";

interface ModelStepProps {
  onDone: () => void;
  onCancel: () => void;
}

// Figma와 다르게 둔 곳: Figma 문구는 "136 / 200 MB"지만 실제로 받는 것은 약 9MB입니다
// (iris를 빼고 blazeface·facemesh·faceres만 복사합니다 — scripts/copy-face-models.mjs).
// 200MB 눈금은 교사에게 있지도 않은 대기를 알리고, 받기가 끝났는데도 눈금이 한참 남습니다.
// 숫자를 여기 적지 않는 것은 모델을 바꿀 때 같이 안 고쳐지기 때문입니다 — 실제로 iris를
// 뺀 뒤에도 200이 남아 있었습니다. manifest는 pnpm models:copy가 만듭니다.
const MODEL_MB = Math.max(1, Math.round(FACE_MODEL_BYTES / 1024 / 1024));
// 크기와 상관없이 약 3초에 걸쳐 끝냅니다. 모델이 커져도 이 화면이 길어지지 않게
// 눈금 수를 고정하고 한 칸 크기를 나눕니다.
const TICKS = 20;
const TICK_MB = MODEL_MB / TICKS;
const TICK_MS = 150;

// TODO(정은): 아직 흉내만 냅니다. 기다리던 모델 지연 로딩은 이제 있습니다 —
// `prepareFaceModels()`(workers/face/client.ts, #231)를 부르면 실제로 받습니다. 다만 HUMAN이
// 진행률을 주지 않아 "받는 중 / 끝남"만 알 수 있어서, 눈금을 어떻게 보여 줄지 정해야 합니다.
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
      detail={`처음 한 번만 다운로드해요 · ${Math.round(loadedMb)} / ${MODEL_MB} MB`}
      percent={Math.round((loadedMb / MODEL_MB) * 100)}
      step="model"
      note={"분석 모델은 이 기기에 저장돼요.\n준비가 끝나면 사진과 발화를 분류합니다."}
      onCancel={onCancel}
    />
  );
}
