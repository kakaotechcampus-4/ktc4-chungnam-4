import type { AreaRoutes } from "./types";

// 담당: 김동건 (④ 얼굴 분류 · 수동 분류 · 하루 정리 · 얼굴 정보). 이 파일은 담당만 고칩니다.
// 추가 예정: teacher "today/classification" → ClassificationPage (1:2952)
//            teacher "today/manual-sort" → ManualSortPage (사진 1:3037, 발화 1:3064)
//            teacher "today/children/:childId/summary" → DaySummaryPage (1:3115)
//            teacher "today/children/:childId/evidence/new" → EvidenceNewPage (1:3095)
//            teacher "children/:childId/face" → FaceRegisterPage (1:3451). 메뉴는 '우리 반 관리'
export const classifyRoutes: AreaRoutes = {
  teacher: [],
};
