// Figma: 추출본 Untitled 1:1895 (확정 파일 노드는 classify.ts 목록에 없음)
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";

import { deleteFaceEmbedding } from "@/api/face";
import { mediaKeys } from "@/api/media";
import { organizationKeys } from "@/api/organization";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { useRouteChild } from "@/features/classify/use-route-child";

// 되돌릴 수 없는 동작이라 Figma대로 별도 화면에서 한 번 더 묻습니다.
// Figma와 다르게 둔 곳: Figma 문구는 '이 기기에 저장된 정보'이지만, 기기에서 버리는 것은 등록 사진
// 원본뿐이고 얼굴 특징정보는 서버에 저장했다가 서버에서 지웁니다(H-3, DELETE /children/{id}/face-embedding).
// 개인정보를 어디서 처리하는지 잘못 알리지 않게 '서버에 저장된'으로 씁니다(10/30 배포 점검 8번).
export function FaceDeletePage() {
  const route = useRouteChild();
  const { currentClass } = useCurrentClass();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const removal = useMutation({ mutationFn: deleteFaceEmbedding });

  if (route.status !== "ready") return <RouteChildFallback state={route} />;
  const { child } = route;
  const className = currentClass?.name ?? "";
  const faceHome = `/t/children/${child.child_id}/face`;

  function remove() {
    removal.mutate(child.child_id, {
      // 파기 기록(DeletionLog)은 서버가 남깁니다(H-4). 화면은 결과만 알려 줍니다.
      onSuccess: async () => {
        // 지운 벡터를 캐시가 들고 있으면 교사가 삭제를 누른 뒤에도 그 얼굴로 분류가 돕니다.
        // 기본 staleTime이 30초인데(app/query-client.ts) 처리 화면은 창을 다시 띄워도 새로
        // 받지 않게 꺼 두어서(ClassifyStep), 비우지 않으면 지운 정보가 그대로 쓰입니다.
        // 명단도 함께 비웁니다 — 안 그러면 원아 등록 화면이 "얼굴 정보 등록됨"으로 남습니다.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: mediaKeys.faceEmbeddings(child.class_id) }),
          queryClient.invalidateQueries({ queryKey: organizationKeys.children(child.class_id) }),
        ]);
        navigate(faceHome, { state: { notice: "얼굴 정보를 삭제했어요." } });
      },
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
                등록 사진(최대 3장)으로 만든 얼굴 특징정보
                <br />
                서버에 저장된 자동 분류용 정보
              </p>
            </div>
          </div>
          <p className="text-lead text-ink-muted">
            서버에 저장된 얼굴 특징정보를 삭제해요.
            <br />
            다시 자동 분류하려면 사진을 등록해야 해요.
          </p>
          <p className="text-body text-ink-muted">원아 명단과 작성한 기록은 그대로 유지돼요.</p>
          {/* 삭제는 동의를 남기고, 철회는 동의까지 없앱니다. 보호자가 철회를 요청한 경우의 길입니다(FR-22). */}
          <p className="text-body text-ink-muted">
            보호자가 얼굴 특징정보 동의 철회를 요청했다면{" "}
            <Link to="../revoke" relative="path" className="font-bold text-ink underline">
              동의 철회
            </Link>
            로 진행해 주세요.
          </p>
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
