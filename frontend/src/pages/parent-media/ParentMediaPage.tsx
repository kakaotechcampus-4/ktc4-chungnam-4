// Figma: 없음 — 학부모 사진·영상 모아 보기(FR-10)는 화면 원본이 아직 없습니다.
import { useParams } from "react-router";

import { ParentMediaGallery } from "./components/ParentMediaGallery";

// 주소는 /p/children/:childId/media (app/routes/parent.ts). 틀과 가드는 라우터의 ParentLayout·RequireRole입니다.
export function ParentMediaPage() {
  const { childId = "" } = useParams<{ childId: string }>();
  return <ParentMediaGallery childId={childId} />;
}
