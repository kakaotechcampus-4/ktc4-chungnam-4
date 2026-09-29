// Figma: 사진 1:3037 (추출본 Untitled 1:1591) · 발화 1:3064(추출본 1:1841)는 숨김
// 발화 탭을 두지 않는 이유: 발화 문장은 업로드 뒤 서버 STT가 만듭니다(파이프라인 1-B). 이 화면은 업로드 전
// 로컬 검수라 그 시점에 발화가 없고, 영상·음성 메모는 검수 없이 올립니다(테크스펙 ⑧). 발화 귀속 화면이 필요한지는
// 미정입니다(docs/open-questions.md §C "서버 미분류함에서 원아 지정"). 예전 발화 패널은 git 기록에 있습니다.
import type { ReactNode } from "react";
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
import { type LocalPhoto, useUploadQueue } from "@/features/upload-queue/upload-queue-store";

import { ChildPicker } from "./components/ChildPicker";
import { MediaPanel } from "./components/MediaPanel";
import { ReassignView } from "./components/ReassignView";

const CLASSIFICATION = "/t/today/classification";

// 지금 보는 자료를 주소(?item=1~N)에 둡니다. 새로고침과 뒤로 가기에도 같은 자료가 보입니다.
function readItemIndex(value: string | null, length: number): number {
  const index = Number(value) - 1;
  return Number.isInteger(index) && index >= 0 && index < length ? index : 0;
}

export function ManualSortPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { children } = useClassChildren();
  const items = useUploadQueue((state) => state.items);
  const setReview = useUploadQueue((state) => state.setReview);

  // 분류 결과의 아이 카드에서 사진을 누르면 그 한 장의 아이를 바꾸는 모드로 옵니다(Figma에 없는 흐름).
  const reassignId = searchParams.get("photo");
  if (reassignId) return <ReassignView photoId={reassignId} />;

  // 처리한 뒤에도 목록에서 빠지지 않게 "처음부터 수동 확인이 필요했던 항목"으로 고릅니다. 순번이 흔들리지 않습니다.
  const entries = items.filter(needsManualReview);
  const index = readItemIndex(searchParams.get("item"), entries.length);
  const entry = entries[index];
  const processed = entries.filter((item) => item.review_state !== "미검수").length;

  const header = (
    <PageHeader
      eyebrow="오늘의 기록 / 수동 분류"
      title="아이를 정하지 못한 자료를 확인해 주세요"
      subtitle="사진을 선생님이 직접 아이에게 연결할 수 있어요."
      actions={
        // Figma에는 없는 버튼입니다. 하위 단계에서 뒤로 가기에만 기대지 않게 둡니다.
        <Button asChild variant="outline">
          <Link to={CLASSIFICATION}>분류 결과로</Link>
        </Button>
      }
    />
  );

  if (!entry) {
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

  /** 현재 다음부터 한 바퀴 돌며 아직 처리하지 않은 자료를 찾습니다. 없으면 -1 */
  function nextPending(list: LocalPhoto[], from: number) {
    for (let step = 1; step <= list.length; step += 1) {
      const candidate = (from + step) % list.length;
      if (candidate !== from && list[candidate]?.review_state === "미검수") return candidate;
    }
    return -1;
  }

  /** 처리한 뒤: 남은 자료로 가고, 다 끝났으면 분류 결과로 돌아가 알려 줍니다. Figma에는 없는 흐름입니다. */
  function afterResolve() {
    const latest = useUploadQueue.getState().items.filter(needsManualReview);
    const next = nextPending(latest, index);
    if (next === -1)
      navigate(CLASSIFICATION, { state: { notice: "미분류 자료를 모두 정리했어요." } });
    else goTo(next);
  }

  function later() {
    const next = nextPending(entries, index);
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

      <div className="flex items-start gap-6">
        <span className="flex h-12 w-40 items-center justify-center rounded-md border border-brand-border bg-brand text-body font-bold text-brand-ink">
          사진 {entries.length}장
        </span>
        <p className="text-body text-ink-muted">
          처리 {processed} / {entries.length}개
        </p>
      </div>

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

interface PagerButtonProps {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}

function PagerButton({ disabled, onClick, children }: PagerButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-xs outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
