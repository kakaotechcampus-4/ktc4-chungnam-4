// Figma: 1:1450
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { childQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";

import { ConsentForm } from "./components/ConsentForm";

// 아이별 동의 확인(/t/children/:childId/consent). Figma 프레임 이름은 "동의 확인 모달"이지만 FocusCard 한 장 페이지입니다.
// TODO(이한나): 이슈 #39에서 교사가 동의를 등록하는 FR-01이 폐기되고 학부모가 초대 링크로 직접 동의하게 됐습니다(FR-28).
// 이 화면을 계속 둘지(교사 확인용으로 남길지, 읽기 전용으로 바꿀지, 없앨지) 팀 결정이 필요합니다.
export function ChildConsentPage() {
  const { childId = "" } = useParams();
  const childQuery = useQuery(childQueryOptions(childId));

  function renderBody() {
    if (childQuery.isPending) {
      return <p className="text-body text-ink-muted">동의 정보를 불러오는 중이에요.</p>;
    }
    if (childQuery.isError) {
      return (
        <p role="alert" className="text-body text-destructive">
          {childQuery.error.message}
        </p>
      );
    }
    return <ConsentForm child={childQuery.data} />;
  }

  return (
    <>
      <PageHeader
        eyebrow="우리 반 관리 / 동의 관리"
        title="아이별 동의를 기록해요"
        subtitle="보호자에게 받은 동의서의 항목별 결과를 확인해 주세요."
      />
      {renderBody()}
    </>
  );
}
