// Figma: 원안 1:3115 (추출본 Untitled 1:1618) · 후보 A 추출본 Untitled 1:3144 (타임라인·근거 열 미완성)
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { summaryKeys, updateRoutineScene } from "@/api/agents";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { nickname } from "@/features/classify/nickname";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { useRouteChild } from "@/features/classify/use-route-child";
import { cn } from "@/lib/utils";
import type { DailyRoutine, RoutineScene } from "@/types/api-draft/agents";

import { EvidencePanel, type Quote } from "./components/EvidencePanel";
import { FeedbackCard } from "./components/FeedbackCard";
import { type Scene, SceneList } from "./components/SceneList";
import { useClassRoutines } from "./use-class-routines";

// 하루 일과는 가정 API(GET /classes/{id}/daily-routines)에서 옵니다. 방법 1(정리 작업 → 하루 정리 → 초안 작업,
// 09/29 김동건 제안) 기준이고, 팀 합의 전입니다(types/api-draft/agents.ts 아래쪽).

// 초안 단계. 초안 작업(Job)은 반 단위로 한 번 시작합니다. 원래는 정은 님 처리 중 화면(?step=draft)이지만,
// 그 화면이 ?step=draft를 받기 전까지 임시 처리 화면(pages/processing-temp)으로 보냅니다.
const PROCESSING_DRAFT = "/t/today/processing-temp?step=draft";

function toScene(scene: RoutineScene): Scene {
  const quotes = scene.quote_count > 0 ? `멘트 ${scene.quote_count}개` : "멘트 없음";
  return {
    id: scene.scene_id,
    time: scene.activity_time,
    activity: scene.activity,
    text: scene.text,
    meta: `사진 ${scene.photo_count}장 · ${quotes}`,
  };
}

function toQuotes(routine: DailyRoutine): Quote[] {
  return routine.quotes.map((quote) => ({
    id: quote.quote_id,
    source: quote.source,
    label: `${quote.activity_time} · ${quote.activity}`,
    text: quote.text,
  }));
}

/** 근거 패널은 사진 3장을 보여 주고 나머지를 +N으로 셉니다. */
const VISIBLE_PHOTOS = 3;

export function DaySummaryPage() {
  const route = useRouteChild();
  const { recordDate, entries, isPending, error } = useClassRoutines();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const toggle = useMutation({
    mutationFn: ({ childId, scene }: { childId: string; scene: RoutineScene }) =>
      updateRoutineScene(childId, recordDate, scene.scene_id, { excluded: !scene.excluded }),
    onSuccess: (_saved, { childId }) =>
      queryClient.invalidateQueries({
        queryKey: summaryKeys.classRoutines(
          entries.find((entry) => entry.child.child_id === childId)?.child.class_id ?? "",
          recordDate,
        ),
      }),
  });

  if (route.status !== "ready") return <RouteChildFallback state={route} />;
  const { child } = route;
  if (isPending || error) {
    return (
      <p role={error ? "alert" : "status"} className="py-11 text-lead text-ink-muted">
        {error ? error.message : "하루 정리를 불러오는 중이에요"}
      </p>
    );
  }
  const routine = entries.find((entry) => entry.child.child_id === child.child_id)?.routine;
  if (!routine) {
    return (
      <p role="status" className="py-11 text-lead text-ink-muted">
        {nickname(child.name)}의 하루는 아직 정리되지 않았어요.{" "}
        <Link to="/t/today/summary" className="font-bold text-brand-ink underline">
          정리된 아이 보기
        </Link>
      </p>
    );
  }
  const current = routine;
  const excluded = new Set(
    current.scenes.filter((scene) => scene.excluded).map((scene) => scene.scene_id),
  );

  function toggleExcluded(sceneId: string) {
    const scene = current.scenes.find((item) => item.scene_id === sceneId);
    if (scene) toggle.mutate({ childId: child.child_id, scene });
  }

  function startFeedback(prefix: string) {
    setFeedback((prev) => (prev ? `${prev}\n${prefix}` : prefix));
    feedbackRef.current?.focus();
  }

  return (
    // 아래 고정 줄(높이 96)에 마지막 카드가 가려지지 않게 그만큼 비워 둡니다.
    <div className="pb-32">
      <PageHeader
        eyebrow="오늘의 기록 / 하루 정리"
        title={`오늘 ${nickname(child.name)}는 이랬어요`}
        subtitle="사진과 선생님 말씀에서 모은 하루입니다. 맞는지 봐주시면 이걸로 관찰일지와 알림장을 씁니다."
        actions={
          // Figma의 "2 / 5명 확인" 대신 정리된 아이 사이를 오갑니다. 초안은 반 단위로 한 번 만들어서(방법 1)
          // 아이마다 확인 표시를 남기는 API를 두지 않았습니다.
          <nav aria-label="정리된 아이" className="flex flex-wrap gap-2">
            {entries.map((entry) => {
              const active = entry.child.child_id === child.child_id;
              return (
                <Link
                  key={entry.child.child_id}
                  to={`/t/today/children/${entry.child.child_id}/summary`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-label outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "border-brand-border bg-brand font-bold text-brand-ink"
                      : "border-line bg-paper text-ink hover:bg-tint-2",
                  )}
                >
                  {entry.child.name}
                </Link>
              );
            })}
          </nav>
        }
      />

      <div className="flex items-start gap-5.5">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <SceneList
            scenes={current.scenes.map(toScene)}
            sourceLabel={`사진 ${current.source_photo_count}장 · 멘트 ${current.source_quote_count}개에서 모았어요`}
            excluded={excluded}
            onToggleExcluded={toggleExcluded}
            pending={toggle.isPending}
            onFeedback={startFeedback}
          />
          {toggle.error ? (
            <p role="alert" className="text-body text-destructive">
              {toggle.error.message}
            </p>
          ) : null}
          <FeedbackCard value={feedback} onChange={setFeedback} textareaRef={feedbackRef} />
        </div>
        <EvidencePanel
          quotes={toQuotes(current)}
          quoteTotal={current.source_quote_count}
          morePhotoCount={Math.max(0, current.source_photo_count - VISIBLE_PHOTOS)}
        />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper px-6">
        <div className="mx-auto flex h-24 max-w-app items-center justify-between gap-6">
          <div className="flex flex-col gap-1 font-bold">
            <p className="text-nav text-ink">
              정리된 아이 {entries.length}명의 관찰일지와 알림장을 만듭니다
            </p>
            <p className="text-caption text-ink-muted">
              만든 뒤에도 문장을 직접 고치거나 다시 써달라고 하실 수 있어요.
            </p>
          </div>
          {/* 초안 작업이 끝나면 처리 화면이 초안 검토(documents 영역 today/review/:childId)로 보냅니다. */}
          <Button asChild size="lg" className="px-7 text-lead">
            <Link to={PROCESSING_DRAFT}>
              초안 만들기
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
