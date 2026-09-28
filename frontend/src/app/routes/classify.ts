import { ClassificationPage } from "@/pages/classification/ClassificationPage";
import { DaySummaryPage } from "@/pages/day-summary/DaySummaryPage";
import { EvidenceNewPage } from "@/pages/evidence-new/EvidenceNewPage";
import { FaceDeletePage } from "@/pages/face-delete/FaceDeletePage";
import { FaceRegisterPage } from "@/pages/face-register/FaceRegisterPage";
import { ManualSortPage } from "@/pages/manual-sort/ManualSortPage";

import type { AreaRoutes } from "./types";

// 담당: 김동건 (④ 얼굴 분류 · 수동 분류 · 하루 정리 · 얼굴 정보). 이 파일은 담당만 고칩니다.
// 화면 사이 이동: 분류 결과 → 수동 분류 / 추가 근거 / 하루 정리 → (⑤ 초안 검토)
//                얼굴 정보 → 얼굴 정보 삭제 → 얼굴 정보
export const classifyRoutes: AreaRoutes = {
  teacher: [
    { path: "today/classification", Component: ClassificationPage }, // 1:2952
    { path: "today/manual-sort", Component: ManualSortPage }, // 사진 1:3037, 발화 1:3064 (?item=)
    { path: "today/children/:childId/summary", Component: DaySummaryPage }, // 1:3115
    { path: "today/children/:childId/evidence/new", Component: EvidenceNewPage }, // 1:3095
    { path: "children/:childId/face", Component: FaceRegisterPage }, // 1:3451. 메뉴는 '우리 반 관리'
    { path: "children/:childId/face/delete", Component: FaceDeletePage }, // 추출본 1:1895
  ],
};
