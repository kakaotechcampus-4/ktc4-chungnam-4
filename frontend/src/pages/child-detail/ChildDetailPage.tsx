// Figma: 1:703
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router";

import { childOverviewQueryOptions, childQueryOptions } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";
import { faceStatus, NURI_DOMAIN_LABELS, NURI_DOMAINS } from "@/features/organization/labels";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDate, formatWeekday, kstToday } from "@/lib/datetime";
import type { ChildNoteSummary, FaceStatus } from "@/types/api-draft/organization";

import { NuriRadarChart } from "./components/NuriRadarChart";

interface NoteItemProps {
  note: ChildNoteSummary;
  today: string;
}

// 하단 요약 줄의 짧은 얼굴 상태 문구입니다. Figma: "동의 3 / 3  ·  얼굴 등록됨"
const FACE_SHORT_LABELS: Record<FaceStatus, string> = {
  registered: "얼굴 등록됨",
  unregistered: "얼굴 미등록",
  locked: "등록 잠김",
};

const TAG = "rounded-md px-2 py-0.5 text-caption font-bold";

function NoteItem({ note, today }: NoteItemProps) {
  const date = `${formatDate(note.record_date, { year: false, weekday: false })} (${formatWeekday(note.record_date)})`;
  return (
    <li className="flex gap-3.5 border-b border-line py-4">
      <div aria-hidden="true" className="size-14 shrink-0 rounded-md bg-brand" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <p className="text-label font-bold text-ink">{date}</p>
          {note.record_date === today ? (
            <span className={cn(TAG, "bg-brand text-brand-ink")}>오늘</span>
          ) : null}
          <span className={cn(TAG, "bg-canvas text-ink")}>
            {note.published ? "발송 완료" : "발송 전"}
          </span>
        </div>
        <p className="text-label text-ink">{note.summary}</p>
      </div>
    </li>
  );
}

function BackBar() {
  return (
    <div className="flex h-18 items-center bg-paper px-10">
      <Link
        to="/t/children"
        className="flex items-center gap-3 text-label text-ink hover:underline"
      >
        <ChevronLeft aria-hidden="true" className="size-5 text-ink-muted" />
        원아 명단으로
      </Link>
    </div>
  );
}

export function ChildDetailPage() {
  const { childId = "" } = useParams();
  const childQuery = useQuery(childQueryOptions(childId));
  const overviewQuery = useQuery(childOverviewQueryOptions(childId));
  const child = childQuery.data;

  if (childQuery.isError) {
    const notFound =
      childQuery.error instanceof ApiError && childQuery.error.code === "CHILD_NOT_FOUND";
    return (
      <div className="pt-10 pb-10">
        <BackBar />
        <div className="py-7">
          {notFound ? (
            <FocusCard
              centered
              footer={
                <Button asChild size="lg">
                  <Link to="/t/children">원아 명단으로</Link>
                </Button>
              }
            >
              <h1 className="text-h3 font-bold text-ink">원아를 찾을 수 없어요</h1>
              <p className="text-lead text-ink-muted">{childQuery.error.message}</p>
            </FocusCard>
          ) : (
            <p role="alert" className="px-10 text-body text-destructive">
              {childQuery.error.message}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!child) {
    return (
      <div className="pt-10">
        <BackBar />
        <p role="status" className="px-10 py-7 text-body text-ink-muted">
          원아 정보를 불러오고 있어요.
        </p>
      </div>
    );
  }

  const base = `/t/children/${child.child_id}`;
  const today = kstToday();
  const overview = overviewQuery.data;

  return (
    <div className="pt-10 pb-10">
      <BackBar />
      <div className="flex flex-col gap-5 px-10 py-7">
        <section className="flex items-center gap-4 rounded-xl bg-paper px-7 py-6">
          <div aria-hidden="true" className="size-14 shrink-0 rounded-full bg-canvas" />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-h3 font-bold text-ink">{child.name}</h1>
              {child.today_note_sent ? (
                <span className={cn(TAG, "bg-canvas text-ink")}>오늘 발송 완료</span>
              ) : null}
            </div>
            <p className="text-label text-ink-muted">
              {child.class_name} · {child.age_group} · 이번 달 기록 {child.month_record_count}건
            </p>
          </div>
        </section>

        <div className="flex items-start gap-5">
          <section
            aria-labelledby="child-notes-title"
            className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl bg-paper px-7 pt-7 pb-6"
          >
            <div className="mb-1.5 flex items-center justify-between">
              <h2 id="child-notes-title" className="text-lead font-bold text-ink">
                알림장
              </h2>
              <p className="text-caption text-ink-muted">최신순</p>
            </div>
            {overviewQuery.isError ? (
              <p role="alert" className="py-4 text-body text-destructive">
                {overviewQuery.error.message}
              </p>
            ) : !overview ? (
              <p role="status" className="py-4 text-body text-ink-muted">
                알림장을 불러오고 있어요.
              </p>
            ) : overview.recent_notes.length === 0 ? (
              <p className="py-4 text-body text-ink-muted">아직 보낸 알림장이 없어요.</p>
            ) : (
              <ul>
                {overview.recent_notes.map((note) => (
                  <NoteItem key={note.parent_note_id} note={note} today={today} />
                ))}
              </ul>
            )}
            <Link
              to="/t/notes"
              className="mt-4 self-center text-label font-bold text-ink hover:underline"
            >
              지난 알림장 더보기
            </Link>
          </section>

          <section
            aria-labelledby="child-domains-title"
            className="flex w-105 shrink-0 flex-col rounded-xl bg-paper p-7"
          >
            <h2 id="child-domains-title" className="text-lead font-bold text-ink">
              누리과정 5영역
            </h2>
            <p className="mt-0.5 text-caption text-ink-muted">
              이번 달 기록이 어느 영역에 담겼는지 보여줘요
            </p>
            {overview ? (
              <>
                <div className="mt-2 flex justify-center">
                  <NuriRadarChart counts={overview.domain_counts} />
                </div>
                <dl className="grid grid-cols-3 gap-2">
                  {NURI_DOMAINS.map((domain) => (
                    <div
                      key={domain}
                      className="flex flex-col gap-0.5 rounded-md bg-paper px-3 py-2.5"
                    >
                      <dt className="text-caption text-ink-muted">{NURI_DOMAIN_LABELS[domain]}</dt>
                      <dd className="text-nav font-bold text-ink">
                        {overview.domain_counts[domain]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
          </section>
        </div>

        <div className="mt-2 flex items-center gap-5 rounded-xl bg-paper p-5">
          <Button asChild className="w-52.5">
            <Link to={`${base}/edit`}>기본 정보 수정</Link>
          </Button>
          <Button asChild className="w-55">
            <Link to="/t/children/setup">동의 · 얼굴 정보</Link>
          </Button>
          <Button asChild className="w-55">
            <Link to={`${base}/invite`}>학부모 연결 관리</Link>
          </Button>
          <p className="flex gap-2 text-body text-ink-muted">
            <span>
              동의 {child.consent_agreed_count} / {child.consent_total}
            </span>
            <span aria-hidden="true">·</span>
            <span>{FACE_SHORT_LABELS[faceStatus(child)]}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
