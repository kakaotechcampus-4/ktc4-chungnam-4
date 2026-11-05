// Figma: 없음 — 얼굴 정보 삭제(추출본 1:1895)와 같은 모양으로 만들었습니다(FR-22, #225 ⑥).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";

import { mediaKeys } from "@/api/media";
import { organizationKeys, revokeFaceConsent } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { useRouteChild } from "@/features/classify/use-route-child";

// 교사가 보호자의 요청을 받아 ③ 얼굴 특징정보 동의를 철회합니다(1단계, #225 ⑥).
// 얼굴 정보 삭제와 달리 동의 자체가 없어지므로, 보호자가 다시 동의하기 전에는 얼굴을 등록할 수 없습니다.
// 서버가 철회와 얼굴 특징정보 삭제·파기 기록을 한 번에 처리합니다(FR-22, H-4).
export function FaceConsentRevokePage() {
  const route = useRouteChild();
  const { currentClass } = useCurrentClass();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const revoke = useMutation({ mutationFn: revokeFaceConsent });

  if (route.status !== "ready") return <RouteChildFallback state={route} />;
  const { child } = route;
  const className = currentClass?.name ?? "";
  const faceHome = `/t/children/${child.child_id}/face`;

  function submit() {
    revoke.mutate(child.child_id, {
      onSuccess: async () => {
        // 명단(등록 잠김 표시)·원아 상세·반 얼굴 정보(자동 분류 후보)를 새로 받습니다.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: organizationKeys.children(child.class_id) }),
          queryClient.invalidateQueries({ queryKey: organizationKeys.child(child.child_id) }),
          queryClient.invalidateQueries({ queryKey: mediaKeys.faceEmbeddings(child.class_id) }),
        ]);
        navigate(`/t/children/${child.child_id}`, {
          state: { notice: "얼굴 특징정보 동의를 철회했어요." },
        });
      },
    });
  }

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="우리 반 관리 / 얼굴 정보"
        title="얼굴 특징정보 동의 철회"
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
              disabled={!child.face_feature_agreed || revoke.isPending}
              onClick={submit}
            >
              {revoke.isPending ? "철회하는 중…" : "동의 철회"}
            </Button>
          </>
        }
      >
        <div className="flex flex-1 flex-col gap-5">
          {child.face_feature_agreed ? (
            <>
              <h2 className="text-h3 font-bold text-ink">
                {child.name}의 얼굴 특징정보 동의를 철회할까요?
              </h2>
              <p className="text-lead text-ink-muted">
                보호자의 철회 요청을 받았을 때 진행해 주세요.
                <br />
                서버에 저장된 얼굴 특징정보도 바로 삭제돼요.
              </p>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-ink-muted">
                <li>보호자가 다시 동의하기 전에는 얼굴 정보를 등록할 수 없어요.</li>
                <li>이 아이가 나온 사진은 자동 분류와 AI 분석에서 빠져요.</li>
                <li>원아 명단과 작성한 기록, 다른 동의는 그대로 유지돼요.</li>
              </ul>
            </>
          ) : (
            <p role="status" className="text-lead text-ink-muted">
              얼굴 특징정보 동의가 없어 철회할 것이 없어요.
            </p>
          )}
          {revoke.error ? (
            <p role="alert" className="text-body text-destructive">
              {revoke.error.message}
            </p>
          ) : null}
        </div>
      </FocusCard>
    </div>
  );
}
