// Figma: 1:499
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flower, Flower2, LoaderCircle, Plus, Sprout, Sun, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { type ClassSummaryView, organizationKeys } from "@/api/organization";
import { selectClass } from "@/features/class-context/current-class-store";
import { useTeacherCenter } from "@/features/organization/use-teacher-center";
import { staggerStyle } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Figma의 반 아이콘(🌼 ☀️ 🌱 🌷)을 반 순서대로 돌아가며 씁니다.
const CLASS_ICONS: readonly LucideIcon[] = [Flower2, Sun, Sprout, Flower];

const CARD_CLASS = "relative flex min-h-49 flex-col rounded-xl border border-line bg-paper p-6";
// 누를 수 있는 카드임을 알리게 올리면 살짝 뜨고, 누르면 내려앉습니다.
const CARD_INTERACTIVE_CLASS =
  "transition duration-200 ease-soft hover:shadow-card-hover motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-99";

// 즐겨찾기한 반이 먼저, 그 안에서는 서버 순서를 지킵니다.
function sortFavoritesFirst(classes: ClassSummaryView[]) {
  return [...classes].sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));
}

// 온보딩의 반 선택입니다. 값은 Figma 실측입니다(폭 980, 제목 28 → 설명 15 간격 8, 카드 위 32, 카드 사이 16).
export function OnboardingClassSelectPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { teacherName, centerId, centerName, classes, isPending, isError, error } =
    useTeacherCenter();

  const refreshClasses = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationKeys.classes() }),
      queryClient.invalidateQueries({ queryKey: organizationKeys.centerClasses(centerId ?? "") }),
    ]);

  // 같은 어린이집 교사는 반 전체에 접근합니다. 선택은 현재 화면의 반만 바꿉니다.
  const assign = useMutation({
    mutationFn: async (classId: string) => classId,
    onSuccess: async (_saved, classId) => {
      // 고른 반을 현재 반으로 둡니다(#85).
      selectClass(classId);
      await refreshClasses();
      navigate("/t/today");
    },
  });

  const greeting = [centerName, teacherName ? `${teacherName} 선생님` : "선생님"]
    .filter(Boolean)
    .join(" ");
  const title = `${greeting}, 안녕하세요!`;

  return (
    <div className="flex w-full max-w-245 flex-col py-16">
      <h1 className="text-h2 font-bold text-ink">{title}</h1>
      <p className="mt-2 text-nav text-ink-muted">
        어떤 반으로 들어갈까요? 반이 없다면 먼저 추가해 주세요.
      </p>

      {isPending ? (
        <p role="status" className="mt-8 flex items-center gap-2 text-body text-ink-muted">
          <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
          {"반 목록을 불러오고 있어요"}
        </p>
      ) : isError && error ? (
        <p role="alert" className="mt-8 text-body text-destructive motion-safe:animate-enter">
          {error.message}
        </p>
      ) : (
        <>
          {assign.isError ? (
            <p role="alert" className="mt-4 text-label text-destructive motion-safe:animate-nudge">
              {assign.error?.message}
            </p>
          ) : null}
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortFavoritesFirst(classes).map((klass, index) => {
              const Icon = CLASS_ICONS[index % CLASS_ICONS.length] ?? Flower2;
              return (
                <li
                  key={klass.class_id}
                  className={cn(
                    CARD_CLASS,
                    CARD_INTERACTIVE_CLASS,
                    "motion-safe:animate-enter",
                    // 고른 반은 다음 화면으로 넘어갈 때까지 선택된 모양으로 남아, 무엇을 눌렀는지 보입니다.
                    assign.isPending && assign.variables === klass.class_id
                      ? "border-brand-ink bg-primary"
                      : "hover:border-brand-border",
                  )}
                  style={staggerStyle(index)}
                >
                  <div className="flex items-start justify-between">
                    <span className="flex size-11 items-center justify-center rounded-md bg-canvas text-brand-ink">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                  </div>
                  <Link
                    to="/t/today"
                    onClick={(event) => {
                      event.preventDefault();
                      if (!assign.isPending) assign.mutate(klass.class_id);
                    }}
                    className="mt-5 text-lead font-bold text-ink outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                  >
                    {klass.name}
                  </Link>
                  <p className="mt-1 text-label text-ink-muted">원아 {klass.child_count}명</p>
                  {klass.needs_record_today ? (
                    <span className="mt-4 self-start rounded-md bg-canvas px-2.5 py-1.5 text-caption font-bold text-ink">
                      오늘 기록 필요
                    </span>
                  ) : null}
                </li>
              );
            })}
            <li className="motion-safe:animate-enter" style={staggerStyle(classes.length)}>
              <Link
                viewTransition
                to="/onboarding/class/new"
                className={cn(
                  CARD_CLASS,
                  CARD_INTERACTIVE_CLASS,
                  "h-full items-center justify-center gap-2.5 border-dashed text-center outline-none hover:border-brand-border focus-visible:ring-3 focus-visible:ring-ring/50",
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-md bg-canvas text-ink-muted">
                  <Plus aria-hidden="true" className="size-5" />
                </span>
                <span className="text-body font-bold text-ink">반 추가하기</span>
                <span className="text-caption text-ink-muted">반 이름과 원아를 등록해요</span>
              </Link>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
