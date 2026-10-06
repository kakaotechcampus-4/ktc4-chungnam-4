// Figma: 1:2886
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { classDraftsQueryOptions } from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { ApiError } from "@/lib/api-client";
import { formatDate, kstToday } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** 원아별 오늘 기록 상태. 초안 검토 레일처럼 알림장 기준으로 봅니다. */
type RecordState = "approved" | "review" | "generating" | "none";

const STATE_LABEL_MAP: Record<RecordState, string> = {
  approved: "승인 완료",
  review: "검토 필요",
  generating: "생성 중",
  none: "기록 전",
};

const STATE_DETAIL_MAP: Record<RecordState, string> = {
  approved: "사진과 본문을 확인했어요",
  review: "검토가 남아 있어요",
  generating: "초안을 만들고 있어요",
  none: "아직 작성된 기록이 없어요",
};

function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

/** 원아 표시 글자. 성을 뺀 이름 첫 글자입니다(김도윤 → 도). 가정: 성은 한 글자입니다. */
function initialOf(name: string) {
  return name.length >= 3 ? name.slice(1, 2) : name.slice(0, 1);
}

interface StatCardProps {
  label: string;
  count: number;
  note: string;
}

function StatCard({ label, count, note }: StatCardProps) {
  return (
    <div className="flex h-36 flex-1 flex-col gap-1 rounded-2xl bg-paper px-6 py-5">
      <p className="text-body text-ink">{label}</p>
      <p className="text-3xl font-bold text-ink">{count}명</p>
      <p className="text-caption text-ink-muted">{note}</p>
    </div>
  );
}

// 오늘 반의 기록 현황을 한 화면에 모읍니다. /t로 들어오면 여기로 옵니다(app/router.tsx).
export function DashboardPage() {
  const recordDate = kstToday();
  const { currentClass, isPending: classPending, isError: classError, error } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  const draftsQuery = useQuery({
    ...classDraftsQueryOptions(classId, recordDate),
    enabled: classId !== "",
  });

  const title = currentClass ? `${currentClass.name}의 하루를 한눈에` : "우리 반의 하루를 한눈에";
  const header = (subtitle?: string) => (
    <PageHeader
      eyebrow="오늘의 기록  /  대시보드"
      title={title}
      subtitle={subtitle}
      actions={
        <Button asChild size="lg" className="w-60">
          <Link to="/t/today">오늘의 기록 이어하기</Link>
        </Button>
      }
    />
  );

  if (classPending || (classId !== "" && (childrenQuery.isPending || draftsQuery.isPending))) {
    return (
      <>
        {header()}
        <p className="text-body text-ink-muted">반 정보를 불러오는 중이에요.</p>
      </>
    );
  }
  if (classError || childrenQuery.isError || draftsQuery.isError) {
    return (
      <>
        {header()}
        <p className="text-body text-ink-muted">
          {failureText(error ?? childrenQuery.error ?? draftsQuery.error)}
        </p>
      </>
    );
  }

  const items = draftsQuery.data ?? [];
  const rows = (childrenQuery.data ?? []).map((child) => {
    const item = items.find((entry) => entry.child_id === child.child_id);
    // 미분류도 교사가 확인해야 하는 기록이라 "검토 필요"로 묶습니다(초안 검토 레일과 같은 규칙).
    // 생성 중(draft)은 아직 검토할 수 없어 따로 셉니다(레일도 #107에서 "생성 중"으로 따로 보입니다).
    const status = item?.parent_note?.status;
    const state: RecordState =
      status === "approved"
        ? "approved"
        : status === "draft"
          ? "generating"
          : item?.parent_note || item?.unclassified
            ? "review"
            : "none";
    return { child, state };
  });
  const countOf = (state: RecordState) => rows.filter((row) => row.state === state).length;
  const approved = countOf("approved");
  const review = countOf("review");
  const generating = countOf("generating");
  const none = countOf("none");
  const summary = [
    `승인 완료 ${approved}명`,
    review > 0 ? `검토 필요 ${review}명` : null,
    generating > 0 ? `생성 중 ${generating}명` : null,
    `기록 전 ${none}명`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <>
      {header(`${formatDate(recordDate)}  ·  원아 ${rows.length}명`)}
      <div className="flex flex-col gap-6">
        <div className="flex gap-6">
          <StatCard label="승인 완료" count={approved} note="게시할 준비가 되었어요" />
          {/* 승인 완료 + 남은 원아 = 우리 반 원아가 되도록, 승인 전인 원아를 모두 셉니다. */}
          <StatCard
            label="남은 원아"
            count={rows.length - approved}
            note="검토하거나 기록할 아이예요"
          />
          <StatCard label="우리 반 원아" count={rows.length} note="동의와 얼굴 정보를 관리해요" />
        </div>

        <section aria-labelledby="dashboard-roster" className="rounded-2xl bg-paper px-6">
          <div className="flex h-18 items-center justify-between">
            <h2 id="dashboard-roster" className="text-xl font-bold text-ink">
              원아별 오늘 기록
            </h2>
            <p className="text-body text-ink-muted">{summary}</p>
          </div>
          {rows.length === 0 ? (
            <p className="py-5 text-body text-ink-muted">아직 반에 등록된 원아가 없어요.</p>
          ) : (
            <ul>
              {rows.map(({ child, state }) => (
                <li key={child.child_id} className="flex h-16 items-center gap-5">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tint-2 text-body font-bold text-ink"
                  >
                    {initialOf(child.name)}
                  </span>
                  <p className="w-50 shrink-0 text-lead font-bold text-ink">{child.name}</p>
                  <p
                    className={cn(
                      "w-50 shrink-0 text-body",
                      state === "none" || state === "generating" ? "text-ink-muted" : "text-ink",
                    )}
                  >
                    {STATE_LABEL_MAP[state]}
                  </p>
                  <p className="min-w-0 flex-1 text-body text-ink-muted">
                    {STATE_DETAIL_MAP[state]}
                  </p>
                  {state === "generating" ? (
                    <Button variant="secondary" size="sm" className="w-32" disabled>
                      검토하기
                    </Button>
                  ) : (
                    <Button asChild variant="secondary" size="sm" className="w-32">
                      {/* 기록 전인 아이도 초안 검토로 보냅니다. 초안이 없으면 그 자리에서 직접 씁니다. */}
                      <Link
                        to={`/t/today/review/${child.child_id}`}
                        aria-label={`${child.name} ${state === "none" ? "기록하기" : "검토하기"}`}
                      >
                        {state === "none" ? "기록하기" : "검토하기"}
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="flex h-12 items-center text-caption text-ink-muted">
            승인한 기록을 모아 게시하면 보호자에게 공개돼요.
          </p>
        </section>
      </div>
    </>
  );
}
