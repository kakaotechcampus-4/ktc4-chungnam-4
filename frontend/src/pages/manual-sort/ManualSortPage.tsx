// Figma: 사진 1:3037 (추출본 Untitled 1:1591) · 발화 1:3064 (추출본 1:1841)
// 발화는 영상·음성을 분류와 함께 먼저 올려 서버 STT가 만듭니다(#83 리뷰, 팀 결정 전 제안). 사진은 여전히
// 업로드 전 로컬 검수이고, 발화 연결은 서버에 바로 저장합니다(pages/manual-sort/components/SpeechSortView.tsx).
import { Link, useNavigate, useSearchParams } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import {
  assignResult,
  childIdsOf,
  EXCLUDE_RESULT,
  needsManualReview,
} from "@/features/classify/review-policy";
import { useClassChildren } from "@/features/classify/use-class-children";
import { useQueueTranscripts } from "@/features/classify/use-queue-transcripts";
import { type LocalPhoto, useUploadQueue } from "@/features/upload-queue/upload-queue-store";

import { ChildPicker } from "./components/ChildPicker";
import { MediaPanel } from "./components/MediaPanel";
import { PagerButton } from "./components/PagerButton";
import { ReassignView } from "./components/ReassignView";
import { SortTabs } from "./components/SortTabs";
import { SpeechSortView } from "./components/SpeechSortView";
import { nextPending, readItemIndex } from "./sort-navigation";

const CLASSIFICATION = "/t/today/classification";

export function ManualSortPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { children, isError: childrenFailed, error: childrenError } = useClassChildren();
  const items = useUploadQueue((state) => state.items);
  const setReview = useUploadQueue((state) => state.setReview);
  const { segments } = useQueueTranscripts();

  // 분류 결과의 아이 카드에서 사진을 누르면 그 한 장의 아이를 바꾸는 모드로 옵니다(Figma에 없는 흐름).
  const reassignId = searchParams.get("photo");
  if (reassignId) return <ReassignView photoId={reassignId} />;

  // 처리한 뒤에도 목록에서 빠지지 않게 "처음부터 수동 확인이 필요했던 항목"으로 고릅니다. 순번이 흔들리지 않습니다.
  const entries = items.filter(needsManualReview);
  const index = readItemIndex(searchParams.get("item"), entries.length);
  const entry = entries[index];
  const processed = entries.filter((item) => item.review_state !== "미검수").length;
  const tab = searchParams.get("tab") === "speech" ? "speech" : "photo";

  const header = (
    <PageHeader
      eyebrow="오늘의 기록 / 수동 분류"
      title="아이를 정하지 못한 자료를 확인해 주세요"
      subtitle="사진과 발화를 선생님이 직접 아이에게 연결할 수 있어요."
      actions={
        // Figma에는 없는 버튼입니다. 하위 단계에서 뒤로 가기에만 기대지 않게 둡니다.
        <Button asChild variant="outline">
          <Link to={CLASSIFICATION}>분류 결과로</Link>
        </Button>
      }
    />
  );

  // 명단을 못 받으면 연결할 아이를 고를 수 없습니다. 빈 목록으로 대신하지 않고 알립니다.
  const childrenAlert = childrenFailed ? (
    <p role="alert" className="mb-4 rounded-md bg-coral-soft px-4 py-3 text-body text-coral-ink">
      원아 명단을 불러오지 못해 아이를 고를 수 없어요.
      {childrenError?.message ? ` (${childrenError.message})` : null}
    </p>
  ) : null;

  const renderTabs = (tabProcessed: number, tabTotal: number) => (
    <SortTabs
      active={tab}
      photoCount={entries.length}
      speechCount={segments.length}
      processed={tabProcessed}
      total={tabTotal}
    />
  );

  if (tab === "speech") {
    return (
      <div className="pb-10">
        {header}
        {childrenAlert}
        <SpeechSortView renderTabs={renderTabs} />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="pb-10">
        {header}
        {renderTabs(processed, entries.length)}
        <FocusCard
          className="mt-7"
          centered
          footer={
            <Button asChild size="lg">
              <Link to={CLASSIFICATION}>분류 결과로 돌아가기</Link>
            </Button>
          }
        >
          <h2 className="text-h3 font-bold text-ink">확인할 사진이 없어요</h2>
          <p className="text-lead text-ink-muted">
            아이를 정하지 못한 자료가 생기면 여기에 모여요.
          </p>
        </FocusCard>
      </div>
    );
  }
  const current = entry;

  function goTo(next: number) {
    setSearchParams({ item: String(next + 1) });
  }

  const isPending = (item: LocalPhoto) => item.review_state === "미검수";

  /** 처리한 뒤: 남은 자료로 가고, 다 끝났으면 분류 결과로 돌아가 알려 줍니다. Figma에는 없는 흐름입니다. */
  function afterResolve() {
    const latest = useUploadQueue.getState().items.filter(needsManualReview);
    const next = nextPending(latest, index, isPending);
    if (next === -1)
      navigate(CLASSIFICATION, { state: { notice: "미분류 사진을 모두 정리했어요." } });
    else goTo(next);
  }

  function later() {
    const next = nextPending(entries, index, isPending);
    if (next !== -1) goTo(next);
  }

  function connect(childIds: string[]) {
    setReview(current.client_id, assignResult(childIds));
    afterResolve();
  }

  function excludeCurrent() {
    setReview(current.client_id, EXCLUDE_RESULT);
    afterResolve();
  }

  return (
    <div className="pb-10">
      {header}
      {childrenAlert}
      {renderTabs(processed, entries.length)}

      <div className="mt-7 flex gap-7">
        <section
          aria-label="선택 자료"
          className="flex h-132.5 w-190 shrink-0 flex-col gap-4 rounded-2xl bg-paper p-6"
        >
          <MediaPanel item={current} />
        </section>

        {/* 자료가 바뀌면 선택을 새로 시작합니다. */}
        <ChildPicker
          key={current.client_id}
          title="이 자료 속 아이"
          childList={children}
          initialSelected={childIdsOf(current)}
          onConnect={connect}
        />
      </div>

      <div className="mt-6 flex items-start gap-7">
        <Button className="w-45 border-transparent" onClick={excludeCurrent}>
          이 자료 제외
        </Button>
        <Button className="w-45 border-transparent" onClick={later}>
          나중에 확인
        </Button>
        <div className="flex items-center gap-6 pt-2.5 text-nav text-ink-muted">
          <PagerButton disabled={index === 0} onClick={() => goTo(index - 1)}>
            ‹ 이전 자료
          </PagerButton>
          <span aria-live="polite">
            {index + 1} / {entries.length}
          </span>
          <PagerButton disabled={index === entries.length - 1} onClick={() => goTo(index + 1)}>
            다음 자료 ›
          </PagerButton>
        </div>
      </div>
    </div>
  );
}
