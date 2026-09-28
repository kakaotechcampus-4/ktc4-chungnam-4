import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";

import { classifiedQueue, confirmedQueue } from "./fixtures/upload-queue";
import { isMockScenario } from "./scenario";

// 업로드 큐 시나리오. 새로고침해도 큐가 채워진 채로 화면을 열어 볼 수 있게 합니다.
// - ?mock=upload.classified-queue: 분류 끝, 교사 확인 전. 예: /t/today/classification?mock=upload.classified-queue
// - ?mock=upload.confirmed-queue: 교사 확인 끝. 예: /t/today/processing?step=send&mock=upload.confirmed-queue
// 시나리오는 탭에 남으므로, 흐름을 끝내 큐를 비워도 새로고침하면 다시 채워집니다. 끄려면 ?mock= 로 엽니다.
export function seedUploadQueue() {
  if (isMockScenario("upload.confirmed-queue")) {
    useUploadQueue.setState({ items: confirmedQueue() });
  } else if (isMockScenario("upload.classified-queue")) {
    useUploadQueue.setState({ items: classifiedQueue() });
  }
}
