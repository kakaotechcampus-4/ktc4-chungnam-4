// Figma: 추출본 Untitled 1:1895 (확정 파일 노드는 classify.ts 목록에 없음)
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";

import { deleteFaceEmbedding } from "@/api/face";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { useRouteChild } from "@/features/classify/use-route-child";

// 되돌릴 수 없는 동작이라 Figma대로 별도 화면에서 한 번 더 묻습니다.
export function FaceDeletePage() {
  const route = useRouteChild();
  const { currentClass } = useCurrentClass();
  const navigate = useNavigate();
  const removal = useMutation({ mutationFn: deleteFaceEmbedding });

  if (route.status !== "ready") return <RouteChildFallback state={route} />;
  const { child } = route;
  const className = currentClass?.name ?? "";
  const faceHome = `/t/children/${child.child_id}/face`;

  function remove() {
    removal.mutate(child.child_id, {
      // 파기 기록(DeletionLog)은 서버가 남깁니다(H-4). 화면은 결과만 알려 줍니다.
      onSuccess: () => navigate(faceHome, { state: { notice: "얼굴 정보를 삭제했어요." } }),
    });
  }

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="우리 반 관리 / 얼굴 정보"
        title="얼굴 정보 삭제"
        subtitle={`${child.name} · ${className}`}
      />

      <FocusCard
        className="min-h-140"
        footer={
          <>
            <Button asChild className="w-25 border-transparent">
              <Link to={faceHome}>취소</Link>
            </Button>
            <Button
              className="w-45 border-transparent"
              disabled={removal.isPending}
              onClick={remove}
            >
              {removal.isPending ? "삭제하는 중…" : "얼굴 정보 삭제"}
            </Button>
          </>
        }
      >
        <div className="flex flex-1 flex-col gap-5">
          <h2 className="text-h3 font-bold text-ink">등록한 얼굴 정보를 삭제할까요?</h2>
          <div className="flex h-40 items-center gap-5 rounded-xl bg-tint-2 px-6">
            <PhotoPlaceholder label={`${child.name} 등록 사진`} className="size-28 rounded-xl" />
            <div className="flex flex-col gap-2.5">
              <p className="text-lg font-bold text-ink">
                {child.name} · {className}
              </p>
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
          {removal.error ? (
            <p role="alert" className="text-body text-destructive">
              {removal.error.message}
            </p>
          ) : null}
        </div>
      </FocusCard>
    </div>
  );
}
