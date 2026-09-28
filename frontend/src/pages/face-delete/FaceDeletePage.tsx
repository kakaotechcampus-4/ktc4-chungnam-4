// Figma: 추출본 Untitled 1:1895 (확정 파일 노드는 classify.ts 목록에 없음)
import { Link, useNavigate, useParams } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { findSampleChild } from "@/features/classify/sample-data";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";

// 되돌릴 수 없는 동작이라 Figma대로 별도 화면에서 한 번 더 묻습니다.
export function FaceDeletePage() {
  const { childId } = useParams();
  const child = findSampleChild(childId);
  const navigate = useNavigate();

  if (!child) return <NotFoundPage />;

  const faceHome = `/t/children/${child.id}/face`;

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="우리 반 관리 / 얼굴 정보"
        title="얼굴 정보 삭제"
        subtitle={`${child.name} · 햇살반`}
      />

      <FocusCard
        className="min-h-140"
        footer={
          <>
            <Button asChild className="w-25 border-transparent">
              <Link to={faceHome}>취소</Link>
            </Button>
            {/* TODO(김동건): 삭제 API(파기는 서버가 DeletionLog에 남김, H-4)가 정해지면 삭제 후 이동합니다. */}
            <Button className="w-45 border-transparent" onClick={() => navigate(faceHome)}>
              얼굴 정보 삭제
            </Button>
          </>
        }
      >
        <div className="flex flex-1 flex-col gap-5">
          <h2 className="text-h3 font-bold text-ink">등록한 얼굴 정보를 삭제할까요?</h2>
          <div className="flex h-40 items-center gap-5 rounded-xl bg-tint-2 px-6">
            <PhotoPlaceholder label={`${child.name} 등록 사진`} className="size-28 rounded-xl" />
            <div className="flex flex-col gap-2.5">
              <p className="text-lg font-bold text-ink">{child.name} · 햇살반</p>
              <p className="text-body text-ink-muted">
                등록 사진 3장으로 만든 얼굴 특징정보
                <br />이 기기에 저장된 자동 분류용 정보
              </p>
            </div>
          </div>
          <p className="text-lead text-ink-muted">
            이 기기에서 사용하던 얼굴 특징정보를 삭제해요.
            <br />
            다시 자동 분류하려면 사진을 등록해야 해요.
          </p>
          <p className="text-body text-ink-muted">원아 명단과 작성한 기록은 그대로 유지돼요.</p>
        </div>
      </FocusCard>
    </div>
  );
}
