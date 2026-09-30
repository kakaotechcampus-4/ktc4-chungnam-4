// Figma: 1:1402
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { classChildrenQueryOptions } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentClass } from "@/features/class-context/use-current-class";

import { ChildRow } from "./components/ChildRow";

// 원아 명단(/t/children). 이름 검색은 받은 명단 안에서만 거릅니다.
export function ChildrenPage() {
  const { currentClass, isPending: classPending, error: classError } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: currentClass !== null,
  });
  const [keyword, setKeyword] = useState("");

  const children = childrenQuery.data ?? [];
  const trimmed = keyword.trim();
  const filtered = trimmed ? children.filter((child) => child.name.includes(trimmed)) : children;

  const subtitle = currentClass
    ? childrenQuery.data
      ? `${currentClass.name} · 재원 원아 ${children.length}명`
      : currentClass.name
    : undefined;

  function renderBody() {
    if (classPending || (currentClass && childrenQuery.isPending)) {
      return <p className="text-body text-ink-muted">명단을 불러오는 중이에요.</p>;
    }
    const error = classError ?? childrenQuery.error;
    if (error) {
      return (
        <p role="alert" className="text-body text-destructive">
          {error.message}
        </p>
      );
    }
    if (!currentClass) {
      return <p className="text-body text-ink-muted">담당하는 반이 없어요.</p>;
    }
    if (children.length === 0) {
      return (
        <FocusCard centered>
          <h2 className="text-h3 font-bold text-ink">아직 등록한 원아가 없어요</h2>
          <p className="text-lead text-ink-muted">
            원아를 추가하고 보호자 동의와 얼굴 정보를 확인해 주세요.
          </p>
          <Button asChild className="w-40">
            <Link to="/t/children/new">원아 추가</Link>
          </Button>
        </FocusCard>
      );
    }
    return (
      <div className="flex flex-col rounded-2xl bg-paper p-6">
        {filtered.length === 0 ? (
          <p className="p-4 text-body text-ink-muted">
            &lsquo;{trimmed}&rsquo;에 맞는 원아가 없어요.
          </p>
        ) : (
          <ul aria-label="원아 명단" className="flex flex-col">
            {filtered.map((child) => (
              <ChildRow key={child.child_id} child={child} klassName={currentClass.name} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  const showToolbar = currentClass !== null && children.length > 0;

  return (
    <>
      <PageHeader eyebrow="우리 반 관리" title="원아 명단" subtitle={subtitle} />
      {showToolbar ? (
        <div className="mb-4 flex items-center justify-between gap-6">
          <Input
            type="search"
            inputSize="compact"
            aria-label="이름으로 검색"
            placeholder="이름으로 검색"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="h-12 max-w-205 border-transparent bg-primary"
          />
          <Button asChild className="w-40">
            <Link to="/t/children/new">원아 추가</Link>
          </Button>
        </div>
      ) : null}
      {renderBody()}
    </>
  );
}
