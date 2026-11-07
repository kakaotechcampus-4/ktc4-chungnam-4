// Figma: 없음 (FR-11 공지 게시판, should — 화면 시안 없이 기존 화면 문법으로 만듭니다)
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { classNoticesInfiniteQueryOptions } from "@/api/notice";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";

import { NoticeRow } from "./components/NoticeRow";

const EYEBROW = "공지";
const TITLE = "학부모께 전할 소식을 올려요";

interface StatusMessageProps {
  children: ReactNode;
  alert?: boolean;
}

function StatusMessage({ children, alert = false }: StatusMessageProps) {
  return (
    <p role={alert ? "alert" : "status"} className="py-10 text-center text-body text-ink-muted">
      {children}
    </p>
  );
}

// 교사의 공지 게시판입니다. 반 단위라 지금 고른 반의 공지만 보이고, 등록하면 그 반 학부모에게 바로 보입니다.
export function NoticeBoardPage() {
  const { currentClass, isPending, isError, error } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const notices = useInfiniteQuery({
    ...classNoticesInfiniteQueryOptions(classId),
    enabled: classId !== "",
  });

  if (isPending) {
    return (
      <>
        <PageHeader eyebrow={EYEBROW} title={TITLE} />
        <StatusMessage>반 정보를 불러오고 있어요.</StatusMessage>
      </>
    );
  }
  if (isError || !currentClass) {
    return (
      <>
        <PageHeader eyebrow={EYEBROW} title={TITLE} />
        <StatusMessage alert={isError}>
          {error?.message ?? "담당하는 반이 아직 없어요."}
        </StatusMessage>
      </>
    );
  }

  const items = notices.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        eyebrow={EYEBROW}
        title={TITLE}
        subtitle={`${currentClass.name} 학부모에게 보이는 공지예요`}
        actions={
          <Button asChild className="w-40">
            <Link to="/t/notices/new">+ 새 공지</Link>
          </Button>
        }
      />

      {notices.isPending ? (
        <StatusMessage>공지를 불러오고 있어요.</StatusMessage>
      ) : notices.isError ? (
        <StatusMessage alert>{notices.error.message}</StatusMessage>
      ) : items.length === 0 ? (
        <FocusCard centered className="min-h-100 justify-center">
          <h2 className="text-h3 font-bold text-ink">아직 올린 공지가 없어요</h2>
          <p className="text-lead text-ink-muted">
            현장학습, 준비물처럼 학부모께 알릴 소식을 올려 보세요.
            <br />
            올리면 우리 반 학부모가 바로 확인할 수 있어요.
          </p>
          <Button asChild className="w-65">
            <Link to="/t/notices/new">첫 공지 올리기</Link>
          </Button>
        </FocusCard>
      ) : (
        <section aria-label="올린 공지" className="rounded-2xl bg-paper px-8">
          <ul>
            {items.map((notice) => (
              <NoticeRow key={notice.notice_id} notice={notice} />
            ))}
          </ul>
          {notices.hasNextPage ? (
            <div className="flex justify-center pb-6">
              <Button
                variant="secondary"
                disabled={notices.isFetchingNextPage}
                onClick={() => void notices.fetchNextPage()}
              >
                {notices.isFetchingNextPage ? "불러오는 중…" : "이전 공지 더 보기"}
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </>
  );
}
