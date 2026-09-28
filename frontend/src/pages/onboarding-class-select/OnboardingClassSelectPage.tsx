// Figma: 1:499
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flower, Flower2, Plus, Sprout, Star, Sun, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";

import {
  assignClass,
  centerClassesQueryOptions,
  organizationKeys,
  setClassFavorite,
} from "@/api/organization";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { cn } from "@/lib/utils";
import type { ClassSummary } from "@/types/api-draft/organization";

// TODO(이한나): #65의 /me가 머지되면 교사 이름을 응답으로 바꿉니다. 지금은 Figma 예시 값입니다.
const PLACEHOLDER_TEACHER_NAME = "김하늘";

// Figma의 반 아이콘(🌼 ☀️ 🌱 🌷)을 반 순서대로 돌아가며 씁니다.
const CLASS_ICONS: readonly LucideIcon[] = [Flower2, Sun, Sprout, Flower];

const CARD_CLASS = "relative flex min-h-49 flex-col rounded-xl border border-line bg-paper p-6";

// 즐겨찾기한 반이 먼저, 그 안에서는 서버 순서를 지킵니다.
function sortFavoritesFirst(classes: ClassSummary[]) {
  return [...classes].sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));
}

// 온보딩의 반 선택입니다. 값은 Figma 실측입니다(폭 980, 제목 28 → 설명 15 간격 8, 카드 위 32, 카드 사이 16).
export function OnboardingClassSelectPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // TODO(이한나): 어린이집은 #65의 GET /me에서 받습니다(API 문서 "반 선택 · 추가"). 지금은 담당 반의 어린이집이라
  // 담당 반이 하나도 없는 첫 교사는 반 목록이 비어 보입니다.
  const { currentClass, isPending: isClassPending } = useCurrentClass();
  const centerId = currentClass?.center_id ?? "";
  const centerQuery = useQuery({
    ...centerClassesQueryOptions(centerId),
    enabled: centerId !== "",
  });
  const classes = centerId === "" ? [] : centerQuery.data;
  const isPending = isClassPending || (centerId !== "" && centerQuery.isPending);
  const { isError, error } = centerQuery;

  const refreshClasses = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationKeys.classes() }),
      queryClient.invalidateQueries({ queryKey: organizationKeys.centerClasses(centerId) }),
    ]);

  const favorite = useMutation({
    mutationFn: ({ classId, isFavorite }: { classId: string; isFavorite: boolean }) =>
      setClassFavorite(classId, isFavorite),
    onSuccess: refreshClasses,
  });

  // 반을 고르면 그 반의 담임으로 배정한 뒤 들어갑니다.
  const assign = useMutation({
    mutationFn: assignClass,
    onSuccess: async () => {
      await refreshClasses();
      navigate("/t/today");
    },
  });

  const centerName = currentClass?.center_name;
  const title = `${centerName ? `${centerName} ` : ""}${PLACEHOLDER_TEACHER_NAME} 선생님, 안녕하세요!`;

  return (
    <div className="flex w-full max-w-5xl flex-col py-16">
      <h1 className="text-h2 font-bold text-ink">{title}</h1>
      <p className="mt-2 text-nav text-ink-muted">
        어떤 반으로 들어갈까요? 즐겨찾기한 반이 먼저 보여요
      </p>

      {isPending ? (
        <p role="status" className="mt-8 text-body text-ink-muted">
          반 목록을 불러오고 있어요
        </p>
      ) : isError && error ? (
        <p role="alert" className="mt-8 text-body text-destructive">
          {error.message}
        </p>
      ) : (
        <>
          {favorite.isError || assign.isError ? (
            <p role="alert" className="mt-4 text-label text-destructive">
              {(favorite.error ?? assign.error)?.message}
            </p>
          ) : null}
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortFavoritesFirst(classes ?? []).map((klass, index) => {
              const Icon = CLASS_ICONS[index % CLASS_ICONS.length] ?? Flower2;
              return (
                <li
                  key={klass.class_id}
                  className={cn(CARD_CLASS, "transition-colors hover:border-brand-border")}
                >
                  <div className="flex items-start justify-between">
                    <span className="flex size-11 items-center justify-center rounded-md bg-canvas text-brand-ink">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    {/* 카드 전체가 링크라 별 버튼은 링크 위로 올립니다. */}
                    <button
                      type="button"
                      aria-label={`${klass.name} 즐겨찾기`}
                      aria-pressed={klass.is_favorite}
                      disabled={favorite.isPending}
                      onClick={() =>
                        favorite.mutate({ classId: klass.class_id, isFavorite: !klass.is_favorite })
                      }
                      className="relative z-10 rounded-xs text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Star
                        aria-hidden="true"
                        className={cn("size-5", klass.is_favorite ? "fill-current" : "text-line")}
                      />
                    </button>
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
            <li>
              <Link
                to="/onboarding/class/new"
                className={cn(
                  CARD_CLASS,
                  "h-full items-center justify-center gap-2.5 border-dashed text-center transition-colors hover:border-brand-border",
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
