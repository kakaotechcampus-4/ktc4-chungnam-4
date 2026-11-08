// Figma: 159:3788 (관찰일지 · 아이 목록)
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { classObservationLogsQueryOptions } from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { useObservationGeneration } from "@/features/documents/use-observation-generation";
import { ApiError } from "@/lib/api-client";
import { kstToday, toKstDate } from "@/lib/datetime";

// 서버가 왜 막았는지 교사가 알아야 다음 행동을 고릅니다(다른 명단 화면과 같은 방식).
function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

// 이 건수 미만이면 일부 칸이 비어 있을 수 있다고 알립니다(월별 관찰일지 합의).
const FEW_NOTES = 5;

function shortDate(isoDateTime: string) {
  const [, month = "", day = ""] = toKstDate(isoDateTime).split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function ObservationLogsPage() {
  const today = kstToday().slice(0, 7);
  const [month, setMonth] = useState(today);
  const {
    currentClass,
    isPending: classPending,
    isError: classError,
    error: classErrorValue,
  } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  const logsQuery = useQuery({
    ...classObservationLogsQueryOptions(classId, month),
    enabled: classId !== "",
  });
  const generation = useObservationGeneration(classId);

  const header = <PageHeader eyebrow="관찰일지" title="우리 반 관찰일지" />;

  if (classError) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">{failureText(classErrorValue)}</p>
      </>
    );
  }
  // 반이 없으면 요청을 보내지 않아 영영 끝나지 않으므로 로딩보다 먼저 판정합니다.
  if (!classPending && currentClass === null) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">담당하는 반이 없어요.</p>
      </>
    );
  }
  if (classPending || childrenQuery.isPending) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">관찰일지를 불러오는 중이에요.</p>
      </>
    );
  }
  if (childrenQuery.isError) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">{failureText(childrenQuery.error)}</p>
      </>
    );
  }

  // 월을 바꿔 새로 받는 동안에도 월 선택은 남겨 둡니다. 화면 전체를 로딩으로 바꾸면 선택기가 사라집니다.
  const monthPicker = (
    <label className="text-body text-ink">
      관찰할 월
      <input
        type="month"
        value={month}
        max={today}
        onChange={(event) => {
          // 입력을 지우면 빈 문자열이 오는데, 그 달은 조회할 수 없어 이전 값을 유지합니다.
          if (event.target.value) setMonth(event.target.value);
        }}
        className="ml-3 rounded-md border border-line bg-paper p-2"
      />
    </label>
  );
  if (logsQuery.isPending || logsQuery.isError) {
    return (
      <>
        {header}
        <div className="mb-4">{monthPicker}</div>
        <p className="text-body text-ink-muted">
          {logsQuery.isError ? failureText(logsQuery.error) : "관찰일지를 불러오는 중이에요."}
        </p>
      </>
    );
  }

  const names = new Map(childrenQuery.data.map((child) => [child.child_id, child.name]));
  const rows = logsQuery.data.items.filter((item) => names.has(item.child_id));
  const created = rows.filter((item) => item.observation_log !== null).length;
  const monthNumber = Number(month.slice(5));

  return (
    <>
      {header}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        {monthPicker}
        <p className="text-body text-ink-muted">
          {rows.length}명 중 {created}명 생성했어요
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-body text-ink-muted">아직 반에 등록된 아이가 없어요.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-paper">
          {rows.map((item) => {
            const name = names.get(item.child_id) ?? "";
            const log = item.observation_log;
            const mine = generation.childId === item.child_id && generation.month === month;
            const running = mine && generation.busy;
            const noNotes = item.published_note_count === 0;
            const few = !noNotes && item.published_note_count < FEW_NOTES;
            const reasonId = `reason-${item.child_id}`;
            return (
              <li key={item.child_id} className="flex flex-wrap items-center gap-4 px-8 py-6">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-h3 font-bold text-ink">{name}</span>
                  <span className="text-body text-ink-muted">
                    {monthNumber}월 알림장 {item.published_note_count}건
                  </span>
                  <span className="text-body text-ink-muted">
                    {log ? `생성됨 · ${shortDate(log.created_at)}` : "생성 전"}
                  </span>
                  {!log && noNotes ? (
                    <span id={reasonId} className="text-caption text-ink-muted">
                      게시된 알림장이 없어 만들 수 없어요
                    </span>
                  ) : null}
                  {!log && few ? (
                    <span id={reasonId} className="text-caption text-ink-muted">
                      자료가 적어 일부 칸이 비어 있을 수 있어요
                    </span>
                  ) : null}
                  {running && !generation.pollError ? (
                    <span role="status" className="text-caption text-ink-muted">
                      {generation.stageLabel}
                    </span>
                  ) : null}
                  {mine && generation.pollError ? (
                    <span role="alert" className="text-caption text-destructive">
                      진행 상태를 불러오지 못했어요. 작업은 계속될 수 있어요.{" "}
                      <button type="button" className="underline" onClick={generation.recheck}>
                        상태 다시 확인
                      </button>
                    </span>
                  ) : null}
                  {mine && !generation.busy && generation.failure ? (
                    <span role="alert" className="text-caption text-destructive">
                      {generation.failure}
                    </span>
                  ) : null}
                </div>
                {log ? (
                  <Button asChild variant="outline">
                    <Link
                      to={`/t/observations/${encodeURIComponent(log.draft_id)}`}
                      aria-label={`${name} 관찰일지 보기`}
                    >
                      보기
                    </Link>
                  </Button>
                ) : (
                  <Button
                    aria-label={`${name} 관찰일지 생성하기`}
                    aria-describedby={noNotes || few ? reasonId : undefined}
                    disabled={noNotes || generation.busy}
                    onClick={() => generation.start(item.child_id, month)}
                  >
                    {running ? "만드는 중" : "생성하기"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
