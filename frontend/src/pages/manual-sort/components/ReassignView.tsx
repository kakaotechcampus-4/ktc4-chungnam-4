import { Link, useNavigate } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { assignResult, childIdsOf, EXCLUDE_RESULT } from "@/features/classify/review-policy";
import { useClassChildren } from "@/features/classify/use-class-children";
import { isPhoto, useUploadQueue } from "@/features/upload-queue/upload-queue-store";

import { ChildPicker } from "./ChildPicker";
import { MediaPanel } from "./MediaPanel";

const CLASSIFICATION = "/t/today/classification";

interface ReassignViewProps {
  photoId: string;
}

// 이미 아이에게 분류된 자료 한 장의 아이를 바꾸거나 빼는 화면입니다. 수동 분류 화면의 틀을 그대로 씁니다.
// Figma에는 없는 흐름입니다(분류 결과 카드의 "아이 변경"). 업로드 큐만 바꾸고 서버에는 보내지 않습니다
// — 귀속은 업로드 전에 확정되므로 이 화면도 업로드 전 검수의 일부입니다.
export function ReassignView({ photoId }: ReassignViewProps) {
  const navigate = useNavigate();
  const { children } = useClassChildren();
  const item = useUploadQueue((state) =>
    state.items.find((i) => i.client_id === photoId && isPhoto(i)),
  );
  const setReview = useUploadQueue((state) => state.setReview);

  const header = (
    <PageHeader
      eyebrow="오늘의 기록 / 분류 바꾸기"
      title="이 자료 속 아이를 다시 골라 주세요"
      subtitle="잘못 연결된 아이는 빼고, 빠진 아이는 더해 주세요."
      actions={
        <Button asChild variant="outline">
          <Link to={CLASSIFICATION}>분류 결과로</Link>
        </Button>
      }
    />
  );

  // 새로고침으로 큐가 비었거나 주소가 틀리면 고칠 자료가 없습니다.
  if (!item || !isPhoto(item)) {
    return (
      <div className="pb-10">
        {header}
        <FocusCard
          centered
          footer={
            <Button asChild size="lg">
              <Link to={CLASSIFICATION}>분류 결과로 돌아가기</Link>
            </Button>
          }
        >
          <h2 className="text-h3 font-bold text-ink">자료를 찾을 수 없어요</h2>
        </FocusCard>
      </div>
    );
  }

  function done(notice: string) {
    navigate(CLASSIFICATION, { state: { notice } });
  }

  return (
    <div className="pb-10">
      {header}

      <div className="flex gap-7">
        <section
          aria-label="선택 자료"
          className="flex h-132.5 w-190 shrink-0 flex-col gap-4 rounded-2xl bg-paper p-6"
        >
          <MediaPanel item={item} />
        </section>
        <ChildPicker
          title="이 자료 속 아이"
          childList={children}
          initialSelected={childIdsOf(item)}
          onConnect={(childIds) => {
            setReview(item.client_id, assignResult(childIds));
            done("사진의 아이를 바꿨어요.");
          }}
        />
      </div>

      <div className="mt-6 flex items-start gap-7">
        <Button
          className="w-45 border-transparent"
          onClick={() => {
            setReview(item.client_id, EXCLUDE_RESULT);
            done("이 자료를 제외했어요.");
          }}
        >
          이 자료 제외
        </Button>
        <Button asChild className="w-45 border-transparent">
          <Link to={CLASSIFICATION}>취소</Link>
        </Button>
      </div>
    </div>
  );
}
