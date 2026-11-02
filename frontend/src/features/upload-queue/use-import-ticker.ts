import { useInterval } from "@/lib/use-interval";

import {
  IMPORT_TICK_AMOUNT,
  IMPORT_TICK_MS,
  isImportDone,
  useUploadQueue,
} from "./upload-queue-store";

/**
 * 담긴 자료를 이 기기로 불러오는 진행을 돌립니다. 자료 올리기와 오늘의 기록 화면이 함께 씁니다.
 * TODO(정은): IndexedDB에 실제로 쓰는 코드가 생기면 이 흉내 타이머를 지웁니다.
 */
export function useImportTicker() {
  const items = useUploadQueue((state) => state.items);
  const advanceImport = useUploadQueue((state) => state.advanceImport);
  const running = items.length > 0 && !isImportDone(items);

  useInterval(() => advanceImport(IMPORT_TICK_AMOUNT), running ? IMPORT_TICK_MS : null);
}
