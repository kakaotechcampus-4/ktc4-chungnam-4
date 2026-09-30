// Figma: 1:1917
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { childQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { formatDotDate } from "@/lib/datetime";

import { ChildForm } from "./components/ChildForm";

// 원아 추가(/t/children/new)와 기본 정보 수정(/t/children/:childId/edit)을 함께 맡습니다.
export function ChildFormPage() {
  const { childId } = useParams();
  const isEdit = childId !== undefined;
  const { currentClass, classes, isPending: classPending, error: classError } = useCurrentClass();
  const childQuery = useQuery({ ...childQueryOptions(childId ?? ""), enabled: isEdit });

  const header = isEdit ? (
    <PageHeader
      eyebrow="우리 반 관리 / 원아 정보 수정"
      title="원아 정보를 고쳐요"
      subtitle="이름, 생년월일, 소속 반을 바꿀 수 있어요."
    />
  ) : (
    <PageHeader
      eyebrow="우리 반 관리 / 원아 추가"
      title="새로운 아이를 맞이해요"
      subtitle="기본 정보를 등록한 뒤 보호자 동의와 얼굴 정보를 확인해요."
    />
  );

  const error = classError ?? (isEdit ? childQuery.error : null);
  const pending = classPending || (isEdit && childQuery.isPending);

  function renderBody() {
    if (error) {
      return (
        <p role="alert" className="text-body text-destructive">
          {error.message}
        </p>
      );
    }
    if (pending) {
      return <p className="text-body text-ink-muted">정보를 불러오는 중이에요.</p>;
    }
    if (isEdit && childQuery.data) {
      const child = childQuery.data;
      return (
        <ChildForm
          childId={child.child_id}
          classes={classes}
          defaultValues={{
            name: child.name,
            birthDate: formatDotDate(child.birth_date),
            classId: child.class_id,
          }}
        />
      );
    }
    if (!currentClass) {
      return (
        <p className="text-body text-ink-muted">담당하는 반이 없어 원아를 추가할 수 없어요.</p>
      );
    }
    return (
      <ChildForm
        classes={classes}
        defaultValues={{ name: "", birthDate: "", classId: currentClass.class_id }}
      />
    );
  }

  return (
    <>
      {header}
      {renderBody()}
    </>
  );
}
