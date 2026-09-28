// Figma: 사진 1:3037 · 발화 1:3064 (추출본 Untitled 1:1591 · 1:1841)
import { type ReactNode, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { SAMPLE_CHILDREN } from "@/features/classify/sample-data";
import { cn } from "@/lib/utils";

import { ChildPicker } from "./components/ChildPicker";
import { SpeechPanel } from "./components/SpeechPanel";

type ItemKind = "photo" | "speech";

export interface SortItem {
  kind: ItemKind;
  meta: string;
  /** 발화 인식 문장. 사진은 없습니다. */
  transcript?: string;
  /** 얼굴 인식이 확실하다고 본 아이. 선택된 채로 보여 주고 나머지만 교사가 고릅니다(frontend/CLAUDE.md 다인원 귀속). */
  suggestedChildIds: readonly string[];
}

// TODO(김동건): 미분류 자료 API가 정해지면 목으로 옮깁니다. 지금은 Figma 예시 값입니다.
const ITEMS = [
  {
    kind: "photo",
    meta: "블록놀이_014.jpg · 오전 10:24",
    suggestedChildIds: [SAMPLE_CHILDREN[0].id],
  },
  // Figma에는 1번 사진과 발화 02만 그려져 있어 나머지는 자리만 채웁니다.
  { kind: "photo", meta: "예시 사진 2", suggestedChildIds: [] },
  { kind: "photo", meta: "예시 사진 3", suggestedChildIds: [] },
  { kind: "speech", meta: "발화 01", transcript: "(인식한 문장 예시)", suggestedChildIds: [] },
  {
    kind: "speech",
    meta: "발화 02 · 오전 10:24",
    transcript: "“내가 더 높이 쌓아 볼게!”",
    suggestedChildIds: [SAMPLE_CHILDREN[0].id],
  },
] as const satisfies readonly SortItem[];

const PHOTO_COUNT = ITEMS.filter((sortItem) => sortItem.kind === "photo").length;
const SPEECH_COUNT = ITEMS.length - PHOTO_COUNT;
const FIRST_SPEECH = ITEMS.findIndex((sortItem) => sortItem.kind === "speech");

// 지금 보는 자료를 주소(?item=1~5)에 둡니다. 새로고침과 뒤로 가기에도 같은 자료가 보입니다.
function readItemIndex(value: string | null): number {
  const index = Number(value) - 1;
  return Number.isInteger(index) && index >= 0 && index < ITEMS.length ? index : 0;
}

export function ManualSortPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const index = readItemIndex(searchParams.get("item"));
  const item: SortItem = ITEMS[index] ?? ITEMS[0];
  const [processed, setProcessed] = useState<ReadonlySet<number>>(new Set());

  function goTo(next: number) {
    setSearchParams({ item: String(next + 1) });
  }

  function finish(markProcessed: boolean) {
    if (markProcessed) setProcessed((prev) => new Set(prev).add(index));
    if (index < ITEMS.length - 1) goTo(index + 1);
  }

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="오늘의 기록 / 수동 분류"
        title="아이를 정하지 못한 자료를 확인해 주세요"
        subtitle="사진·영상과 발화를 선생님이 직접 아이에게 연결할 수 있어요."
      />

      <nav aria-label="자료 유형" className="flex items-start gap-6">
        <KindTab to="?item=1" active={item.kind === "photo"}>
          사진·영상 {PHOTO_COUNT}개
        </KindTab>
        <KindTab to={`?item=${FIRST_SPEECH + 1}`} active={item.kind === "speech"}>
          발화 {SPEECH_COUNT}개
        </KindTab>
        <p className="text-body text-ink-muted">
          처리 {processed.size} / {ITEMS.length}개
        </p>
      </nav>

      <div className="mt-7 flex gap-7">
        <section
          aria-label="선택 자료"
          className={cn(
            "flex h-132.5 w-190 shrink-0 flex-col gap-4 rounded-2xl bg-paper p-6",
            item.kind === "speech" && "justify-center",
          )}
        >
          {item.kind === "photo" ? <PhotoPanel item={item} /> : <SpeechPanel item={item} />}
        </section>

        {/* 자료가 바뀌면 선택을 새로 시작합니다. */}
        <ChildPicker
          key={index}
          title={item.kind === "photo" ? "이 자료 속 아이" : "발화가 해당하는 아이"}
          initialSelected={item.suggestedChildIds}
          onConnect={() => finish(true)}
        />
      </div>

      <div className="mt-6 flex items-start gap-7">
        <Button className="w-45 border-transparent" onClick={() => finish(true)}>
          이 자료 제외
        </Button>
        <Button className="w-45 border-transparent" onClick={() => finish(false)}>
          나중에 확인
        </Button>
        <div className="flex items-center gap-6 pt-2.5 text-nav text-ink-muted">
          <PagerButton disabled={index === 0} onClick={() => goTo(index - 1)}>
            ‹ 이전 자료
          </PagerButton>
          <span aria-live="polite">
            {index + 1} / {ITEMS.length}
          </span>
          <PagerButton disabled={index === ITEMS.length - 1} onClick={() => goTo(index + 1)}>
            다음 자료 ›
          </PagerButton>
        </div>
      </div>
    </div>
  );
}

interface KindTabProps {
  to: string;
  active: boolean;
  children: ReactNode;
}

function KindTab({ to, active, children }: KindTabProps) {
  return (
    <Button asChild className={cn("w-40", !active && "border-transparent")}>
      <Link to={to} aria-current={active ? "page" : undefined}>
        {children}
      </Link>
    </Button>
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

function PhotoPanel({ item }: { item: SortItem }) {
  return (
    <>
      <PhotoPlaceholder label={`선택 자료 ${item.meta}`} className="h-89.5 w-full rounded-xl" />
      <p className="text-body text-ink-muted">{item.meta}</p>
      <p className="text-body text-ink-muted">여러 아이가 함께 나오면 모두 선택해 주세요.</p>
    </>
  );
}
