import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// 교사가 고른 반의 id만 둡니다. 반 이름 같은 서버 데이터는 복사하지 않습니다(frontend/CLAUDE.md §상태 관리).
// 서버에는 저장하지 않고 브라우저(localStorage)에만 둡니다(docs/api/auth.md `GET /api/v1/me`).
// 저장값이 담당 반 목록에 없으면(배정 해제, 같은 기기의 다른 계정) useCurrentClass가 첫 번째 반으로 돌아갑니다.
interface CurrentClassState {
  selectedClassId: string | null;
}

export const useCurrentClassStore = create<CurrentClassState>()(
  persist((): CurrentClassState => ({ selectedClassId: null }), {
    name: "aidam:current-class",
    storage: createJSONStorage(() => window.localStorage),
    version: 1,
  }),
);

/** 현재 반을 바꿉니다. 반 선택·반 만들기처럼 useMutation의 onSuccess에서도 부릅니다. */
export function selectClass(classId: string): void {
  useCurrentClassStore.setState({ selectedClassId: classId });
}
