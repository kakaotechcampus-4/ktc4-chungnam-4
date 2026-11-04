// Figma: 없음 — 학부모 사진·영상 모아 보기(FR-10)는 화면 원본이 아직 없습니다.
import { useParams } from "react-router";

import { ParentMediaGallery } from "./components/ParentMediaGallery";

// 주소는 /p/children/:childId/media (app/routes/parent.ts). 학부모 레이아웃·가드는 W3 화면과 함께 들어옵니다.
export function ParentMediaPage() {
  const { childId = "" } = useParams<{ childId: string }>();
  return (
    <main className="mx-auto w-full max-w-reading px-4 py-8">
      <ParentMediaGallery childId={childId} />
    </main>
  );
}
