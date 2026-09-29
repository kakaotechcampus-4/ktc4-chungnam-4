// Figma: 1:3095 (추출본 Untitled 1:1964)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { classEvidenceQueryOptions, saveTeacherEvidence, summaryKeys } from "@/api/agents";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { useRouteChild } from "@/features/classify/use-route-child";
import { formatDate, kstToday } from "@/lib/datetime";

const BACK_TO = "/t/today/classification";

// 아이·날짜마다 추가 근거는 한 건입니다. 이미 있으면 그 내용을 불러와 고치고, 저장하면 덮어씁니다.
// 주소는 FE 리드가 정한 evidence/new 그대로 두고, 작성과 수정을 이 화면 하나에서 합니다.
export function EvidenceNewPage() {
  const route = useRouteChild();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recordDate = kstToday();
  const classId = route.status === "ready" ? route.child.class_id : "";
  const evidence = useQuery({
    ...classEvidenceQueryOptions(classId, recordDate),
    enabled: route.status === "ready",
  });
  // 고르기 전에는 주소의 아이, 고치기 전에는 저장된 내용을 보여 줍니다. 그래서 초깃값을 null로 둡니다.
  const [targetId, setTargetId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftTime, setDraftTime] = useState<string | null>(null);
  const saving = useMutation({
    mutationFn: (input: { childId: string; activity_time: string; text: string }) =>
      saveTeacherEvidence(input.childId, recordDate, {
        activity_time: input.activity_time,
        text: input.text,
      }),
  });

  if (route.status !== "ready") return <RouteChildFallback state={route} />;
  const { child, children } = route;
  const target = children.find((c) => c.child_id === (targetId ?? child.child_id)) ?? child;
  const existing = evidence.data?.find((note) => note.child_id === target.child_id);
  const note = draftText ?? existing?.text ?? "";
  const activityTime = draftTime ?? existing?.activity_time ?? "10:30";
  const editing = existing !== undefined;

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="오늘의 기록 / 추가 근거"
        title="사진에 담기지 않은 이야기도 남겨요"
        subtitle={`${target.name} · ${formatDate(recordDate, { weekday: false })}`}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          saving.mutate(
            { childId: target.child_id, activity_time: activityTime, text: note.trim() },
            {
              // 분류 결과의 작성/수정 버튼이 바로 바뀌게 목록을 다시 받고, 돌아가서 결과를 알려 줍니다.
              onSuccess: (saved) => {
                void queryClient.invalidateQueries({
                  queryKey: summaryKeys.classEvidence(target.class_id, saved.record_date),
                });
                const verb = editing ? "수정" : "저장";
                navigate(BACK_TO, {
                  state: { notice: `${target.name} 추가 근거를 ${verb}했어요.` },
                });
              },
            },
          );
        }}
      >
        <FocusCard
          className="min-h-140"
          footer={
            <>
              <Button asChild className="w-45 border-transparent">
                <Link to={BACK_TO}>취소</Link>
              </Button>
              <Button
                type="submit"
                className="w-57.5 border-transparent"
                disabled={!note.trim() || saving.isPending || evidence.isPending}
              >
                {saving.isPending ? "저장하는 중…" : editing ? "근거 수정" : "근거 저장"}
              </Button>
            </>
          }
        >
          <div className="flex flex-1 flex-col justify-between gap-5">
            <h2 className="text-h3 font-bold text-ink">교사가 직접 관찰한 내용</h2>

            <div className="flex gap-7 text-body text-ink-muted">
              <label className="flex items-center gap-2">
                연결할 아이 ·
                <span className="relative flex items-center">
                  <select
                    value={target.child_id}
                    onChange={(event) => {
                      // 아이를 바꾸면 그 아이의 저장된 근거를 새로 보여 줍니다.
                      setTargetId(event.target.value);
                      setDraftText(null);
                      setDraftTime(null);
                    }}
                    className="appearance-none rounded-xs bg-transparent pr-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {children.map((option) => (
                      <option key={option.child_id} value={option.child_id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    strokeWidth={2.5}
                    className="pointer-events-none absolute right-0 size-2.5"
                  />
                </span>
              </label>
              <label className="flex items-center gap-2">
                활동 시각 ·
                <input
                  type="time"
                  value={activityTime}
                  onChange={(event) => setDraftTime(event.target.value)}
                  className="rounded-xs bg-transparent outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
            </div>

            <textarea
              value={note}
              onChange={(event) => setDraftText(event.target.value)}
              aria-label="관찰 내용"
              placeholder="예) 나뭇잎의 모양을 비교하며 “별 모양이야”라고 말했어요."
              className="h-42 w-full resize-none rounded-xl bg-brand p-5 text-lead text-brand-ink outline-none placeholder:text-brand-ink/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            />

            {/* TODO(김동건): 음성 메모와 사진 연결은 업로드 흐름이 정해지면 붙입니다. */}
            <div className="flex items-center gap-4 text-body font-bold text-ink">
              <button type="button" disabled className="disabled:opacity-40">
                음성으로 남기기
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" disabled className="disabled:opacity-40">
                관련 사진 연결하기
              </button>
            </div>

            <p className="text-body text-ink-muted">
              {editing
                ? "오늘 남긴 근거를 고치고 있어요. 저장하면 이 내용으로 바뀌어요."
                : "저장한 내용은 초안의 문장별 근거로 연결돼요."}
            </p>
            {saving.error ? (
              <p role="alert" className="text-body text-destructive">
                {saving.error.message}
              </p>
            ) : null}
          </div>
        </FocusCard>
      </form>
    </div>
  );
}
