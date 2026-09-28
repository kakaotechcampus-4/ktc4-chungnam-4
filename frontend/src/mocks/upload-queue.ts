import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";

import { classifiedQueue, confirmedQueue } from "./fixtures/upload-queue";

// 업로드 큐 시나리오. 새로고침해도 큐가 채워진 채로 그 화면을 열어 볼 수 있게 합니다.
// - ?mock=upload.classified-queue: 분류 끝, 교사 확인 전. 예: /t/today/classification?mock=upload.classified-queue
// - ?mock=upload.confirmed-queue: 교사 확인 끝. 예: /t/today/processing?step=send&mock=upload.confirmed-queue
// 다른 시나리오와 달리 탭에 기억된 값은 보지 않고, 지금 주소에 붙은 값만 봅니다.
// 한 번 켠 탭에서 자료 올리기를 처음부터 시연할 때 큐가 차 있지 않게 하려는 것입니다.
function scenariosInAddress() {
  const value = new URLSearchParams(window.location.search).get("mock") ?? "";
  return new Set(value.split(",").filter(Boolean));
}

export function seedUploadQueue() {
  const scenarios = scenariosInAddress();
  if (scenarios.has("upload.confirmed-queue")) {
    useUploadQueue.setState({ items: confirmedQueue() });
  } else if (scenarios.has("upload.classified-queue")) {
    useUploadQueue.setState({ items: classifiedQueue() });
  }
}
