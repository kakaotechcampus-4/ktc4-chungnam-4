// Figma: 1차 결과본 W3 106:4388 (FR-09 학부모 자녀별 알림장). 값은 그대로 옮기지 않고 서비스 토큰에 맞췄습니다.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCheck, MailOpen, SearchX, Users } from "lucide-react";
import { useParams, useSearchParams } from "react-router";

import { parentNotesQueryOptions } from "@/api/documents";
import { myChildrenQueryOptions } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { ParentSearchBox } from "@/features/parent/ParentSearchBox";
import { useParentSearch } from "@/features/parent/use-parent-search";
import { useRefetchOnExpiry } from "@/features/parent/use-refetch-on-expiry";
import { nickname } from "@/lib/child-name";
import { staggerStyle } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ParentNoteCard } from "./components/ParentNoteCard";
import { ParentNotesRail } from "./components/ParentNotesRail";

const NOTICE_CARD_CLASS = "rounded-3xl border border-line/70 shadow-card motion-safe:animate-rise";

function NotesSkeleton() {
  return (
    <ul aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((index) => (
        <li key={index} className="h-72 animate-pulse rounded-3xl bg-neutral-soft" />
      ))}
    </ul>
  );
}

export function ParentNotesPage() {
  const { childId } = useParams();
  const [params, setParams] = useSearchParams();
  const children = useQuery(myChildrenQueryOptions());
  const child =
    children.data?.find((item) => item.child_id === childId) ??
    (!childId ? children.data?.[0] : undefined);
  const { keyword, search, reset, resetCount, initialValue } = useParentSearch();
  const notes = useQuery({
    ...parentNotesQueryOptions(child?.child_id ?? "", params.get("cursor") ?? undefined, keyword),
    enabled: Boolean(child && !child.access_expired),
    // 새 결과가 올 때까지 이전 카드를 흐리게 남겨 둡니다. 비웠다가 다시 그리면 화면이 깜박입니다.
    placeholderData: keepPreviousData,
  });
  const handlePhotoError = useRefetchOnExpiry(notes.refetch);

  // 담임 이름은 서버가 아직 빈 문자열을 줍니다. 비어 있으면 줄에서 뺍니다(docs/api/organization.md).
  const subtitle = child
    ? [
        child.class_name,
        child.center_name,
        child.class_teacher_name ? `${child.class_teacher_name} 선생님` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const header = (
    <PageHeader
      compact
      title={child ? `${nickname(child.name)}의 알림장` : "우리 아이 알림장"}
      subtitle={subtitle}
    />
  );

  if (children.isPending) {
    return (
      <>
        {header}
        <p className="sr-only" role="status">
          자녀를 불러오고 있어요.
        </p>
        <NotesSkeleton />
      </>
    );
  }
  if (children.error) {
    return (
      <>
        {header}
        <FocusCard centered className={NOTICE_CARD_CLASS}>
          <p role="alert" className="text-body text-ink">
            {children.error.message}
          </p>
          <Button variant="outline" onClick={() => void children.refetch()}>
            다시 불러오기
          </Button>
        </FocusCard>
      </>
    );
  }
  if (!children.data.length) {
    return (
      <>
        {header}
        <FocusCard centered className={NOTICE_CARD_CLASS}>
          <Users aria-hidden="true" className="size-10 text-line" strokeWidth={1.5} />
          <h2 className="text-lead font-bold text-ink">연결된 자녀가 없어요</h2>
          <p className="text-body text-ink-muted">선생님께 받은 초대 링크로 연결해 주세요.</p>
        </FocusCard>
      </>
    );
  }
  if (!child) {
    return (
      <>
        {header}
        <FocusCard centered className={NOTICE_CARD_CLASS}>
          <p role="alert" className="text-body text-ink">
            연결된 자녀를 선택해 주세요.
          </p>
        </FocusCard>
      </>
    );
  }
  if (child.access_expired) {
    return (
      <>
        {header}
        <FocusCard centered className={NOTICE_CARD_CLASS}>
          <CalendarClock aria-hidden="true" className="size-10 text-line" strokeWidth={1.5} />
          <p role="alert" className="text-body text-ink">
            이 자녀의 열람 기간이 지났어요.
          </p>
        </FocusCard>
      </>
    );
  }

  const items = notes.data?.items ?? [];
  const unreadCount = notes.data?.unread_count ?? 0;
  // 알림장이 하나도 없는 아이에게는 찾을 것이 없어 검색칸을 숨깁니다. 찾다가 0건이면 검색칸을 남깁니다.
  const showToolbar = items.length > 0 || keyword !== "";

  return (
    <>
      {header}
      {/* 이 줄은 두 칸 위에 둡니다. 목록 칸 안에 두면 첫 카드만 내려가 오른쪽 칸과 윗선이 어긋납니다.
          검색칸은 넓은 화면에서 오른쪽 칸과 폭을 맞추고, 휴대폰에서는 목록 위에 옵니다. */}
      {showToolbar ? (
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <p className="flex items-center gap-2 text-label font-bold text-brand-ink" role="status">
            {keyword ? (
              !notes.data || notes.isPlaceholderData ? (
                "찾고 있어요"
              ) : notes.data.next_cursor ? (
                `${items.length}건 넘게 찾았어요`
              ) : (
                `${items.length}건을 찾았어요`
              )
            ) : unreadCount > 0 ? (
              <>
                <span aria-hidden="true" className="relative flex size-2">
                  <span className="absolute inline-flex size-full rounded-full bg-brand-ink/50 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-brand-ink" />
                </span>
                아직 읽지 않은 알림장 {unreadCount}개
              </>
            ) : (
              <>
                <CheckCheck aria-hidden="true" className="size-4" />
                알림장을 모두 읽었어요
              </>
            )}
          </p>
          <ParentSearchBox
            key={`${child.child_id}-${resetCount}`}
            label="알림장 검색"
            placeholder="날짜나 내용으로 찾기"
            initialValue={initialValue}
            onSearch={search}
            className="w-full shrink-0 lg:w-rail"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section
          aria-label="알림장 목록"
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-6 motion-safe:transition-opacity motion-safe:duration-300",
            notes.isPlaceholderData && "opacity-60",
          )}
        >
          {notes.isPending ? (
            <>
              <p className="sr-only" role="status">
                알림장을 불러오고 있어요.
              </p>
              <NotesSkeleton />
            </>
          ) : notes.error ? (
            <FocusCard centered className={NOTICE_CARD_CLASS}>
              <p role="alert" className="text-body text-ink">
                {notes.error.message}
              </p>
              <Button variant="outline" onClick={() => void notes.refetch()}>
                다시 불러오기
              </Button>
            </FocusCard>
          ) : !items.length && keyword ? (
            <FocusCard centered className={NOTICE_CARD_CLASS}>
              <SearchX aria-hidden="true" className="size-10 text-line" strokeWidth={1.5} />
              <h2 className="text-lead font-bold text-ink">맞는 알림장이 없어요</h2>
              <p className="text-body text-ink-muted">다른 말이나 날짜로 찾아보세요.</p>
              <Button variant="outline" className="active:scale-98" onClick={reset}>
                전체 알림장 보기
              </Button>
            </FocusCard>
          ) : !items.length ? (
            <FocusCard centered className={NOTICE_CARD_CLASS}>
              <MailOpen aria-hidden="true" className="size-10 text-line" strokeWidth={1.5} />
              <h2 className="text-lead font-bold text-ink">아직 도착한 알림장이 없어요</h2>
              <p className="text-body text-ink-muted">
                선생님이 알림장을 보내면 여기에서 볼 수 있어요.
              </p>
            </FocusCard>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {items.map((note, index) => (
                <li
                  key={note.parent_note_id}
                  className="motion-safe:animate-rise"
                  style={staggerStyle(index)}
                >
                  <ParentNoteCard
                    note={note}
                    to={`/p/children/${child.child_id}/notes/${note.parent_note_id}`}
                    onPhotoError={handlePhotoError}
                  />
                </li>
              ))}
            </ul>
          )}
          {notes.data?.next_cursor ? (
            <Button
              variant="outline"
              className="self-center active:scale-98"
              onClick={() =>
                setParams({
                  cursor: notes.data.next_cursor as string,
                  ...(keyword ? { q: keyword } : {}),
                })
              }
            >
              이전 알림장 더 보기
            </Button>
          ) : null}
        </section>
        <ParentNotesRail child={child} childList={children.data} list={notes.data} />
      </div>
    </>
  );
}
