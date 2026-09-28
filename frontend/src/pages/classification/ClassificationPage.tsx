// Figma: 1:2952 (추출본 Untitled 1:867)
import { Play } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SAMPLE_CHILDREN } from "@/features/classify/sample-data";
import { cn } from "@/lib/utils";

// TODO(김동건): 분류 결과 API가 정해지면 목으로 옮깁니다. 지금은 Figma 예시 값입니다.
const UNCLASSIFIED = {
  photoCount: 3,
  utterances: [
    { label: "발화 01", duration: "00:26" },
    { label: "발화 02", duration: "00:18" },
  ],
};

const CLASSIFIED = [
  { child: SAMPLE_CHILDREN[0], photoCount: 8, audioCount: 1, videoDuration: "00:18" },
  { child: SAMPLE_CHILDREN[1], photoCount: 7, audioCount: 1 },
  { child: SAMPLE_CHILDREN[2], photoCount: 6, audioCount: 1 },
];

// 겹친 사진 카드의 기울기. Figma의 3° · -2° · 2° · -2° 순서입니다.
const TILTS = ["rotate-3", "-rotate-2", "rotate-2", "-rotate-2"];

export function ClassificationPage() {
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const firstChild = SAMPLE_CHILDREN[0];

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="오늘의 기록 / 분류 결과"
        title="아이별로 잘 모였는지 확인해 주세요"
        subtitle="아이별 자료와 미분류 자료를 함께 확인하고, 빠진 이야기나 잘못 연결된 자료를 정리해 주세요."
      />

      <dl className="flex flex-wrap items-center gap-x-7 gap-y-1 rounded-md bg-brand p-4 text-body">
        <div>
          <dt className="sr-only">올린 자료</dt>
          <dd className="font-bold text-brand-ink">사진 23장 · 영상 1개 · 발화 5개</dd>
        </div>
        <div>
          <dt className="sr-only">분류된 자료</dt>
          <dd className="text-ink-muted">사진 20장 · 영상 1개 · 발화 3개 분류</dd>
        </div>
        <div>
          <dt className="sr-only">확인이 필요한 자료</dt>
          <dd className="font-bold text-brand-ink">확인 필요 5개</dd>
        </div>
        <div>
          <dt className="sr-only">자료 있는 원아</dt>
          <dd className="text-caption text-ink-muted">자료 있는 원아 3 / 전체 5명</dd>
        </div>
      </dl>

      {/* 원아가 많아도 아래 확인 줄이 밀려나지 않게 목록만 스크롤합니다(Figma 480 높이). */}
      <ul
        aria-label="아이별 자료"
        className="mt-2 flex max-h-120 flex-col gap-4 overflow-y-auto pr-4"
      >
        <li className="flex min-h-44 items-center justify-between gap-6 rounded-xl bg-paper p-6">
          <div
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-3xl font-bold text-ink"
          >
            ?
          </div>
          <div className="flex w-34 shrink-0 flex-col gap-2">
            <h2 className="text-lg font-bold text-ink">미분류 자료</h2>
            <p className="text-caption text-ink-muted">
              사진 {UNCLASSIFIED.photoCount}장 · 발화 {UNCLASSIFIED.utterances.length}개
            </p>
          </div>
          <div className="flex w-137.5 shrink-0 flex-col items-center gap-3">
            <StackedPhotos count={UNCLASSIFIED.photoCount} label="미분류 사진" compact />
            <ul className="flex gap-4 text-body text-ink-muted">
              {UNCLASSIFIED.utterances.map((utterance) => (
                <li key={utterance.label} className="flex items-center gap-1.5">
                  <Play aria-hidden="true" className="size-3.5 fill-current" />
                  {utterance.label} · {utterance.duration}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex w-52.5 shrink-0 flex-col items-end gap-3">
            <Button asChild className="w-46">
              <Link to="/t/today/manual-sort">자료 분류하기 →</Link>
            </Button>
            <p className="text-caption text-ink-muted">사진·영상·발화를 연결해요</p>
          </div>
        </li>

        {CLASSIFIED.map(({ child, photoCount, audioCount, videoDuration }) => (
          <li
            key={child.id}
            className="flex min-h-44 items-center justify-between gap-6 rounded-xl bg-paper p-6"
          >
            <PhotoPlaceholder label={`${child.name} 대표 사진`} className="size-16 rounded-full" />
            <div className="flex w-34 shrink-0 flex-col gap-2">
              <h2 className="text-lg font-bold text-ink">{child.name}</h2>
              <p className="text-caption text-ink-muted">
                사진 {photoCount}장 · 음성 {audioCount}개
              </p>
            </div>
            <div className="relative w-137.5 shrink-0">
              <StackedPhotos count={4} label={`${child.name} 사진`} />
              {videoDuration ? (
                <span className="absolute top-22 left-116 flex h-6 w-20 items-center justify-center gap-1 rounded-sm border border-brand-border bg-brand text-caption text-brand-ink">
                  <Play aria-hidden="true" className="size-3 fill-current" />
                  <span className="sr-only">영상 길이</span>
                  {videoDuration}
                </span>
              ) : null}
            </div>
            <div className="flex w-52.5 shrink-0 flex-col gap-4">
              <Link
                to={`/t/today/children/${child.id}/evidence/new`}
                className="rounded-xs text-body font-bold text-ink outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                + 추가 근거 작성
                <span className="sr-only"> ({child.name})</span>
              </Link>
              {/* TODO(김동건): 전체 사진 보기 · 아이 변경 · 제외 동작은 화면이 정해지면 붙입니다. */}
              <p className="text-caption text-ink-muted">전체 사진 · 아이 변경 · 제외</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-5.5 flex gap-10 text-caption text-ink-muted">
        <p>미분류 사진 3장·발화 2개는 이번 초안에서만 제외돼요.</p>
        {/* 직접 작성 화면은 record 영역(정은)에 있습니다. 등록 전에는 404가 뜹니다. */}
        <Link
          to="/t/today/write"
          className="rounded-xs outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          자료 없는 원아 2명 · 직접 기록 →
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between gap-6 border-t border-line pt-4">
        {/* TODO(김동건): "얼굴 가림"은 09/13에 폐기된 블러를 가리키는 문구입니다(frontend/CLAUDE.md). 문구 확인 필요. */}
        <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
          <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
          아이 분류와 얼굴 가림을 확인했어요
        </label>
        <p className="text-caption text-ink-muted">선택: 사진 20장 · 영상 1개 · 발화 3개</p>
        <Button
          className="w-48"
          disabled={!confirmed}
          onClick={() => navigate(`/t/today/children/${firstChild.id}/summary`)}
        >
          확인한 자료로 계속
        </Button>
      </div>
    </div>
  );
}

interface StackedPhotosProps {
  count: number;
  label: string;
  /** 미분류 카드는 사진이 낮고(90) 덜 겹칩니다(24). 원아 카드는 116 높이에 58씩 겹칩니다. */
  compact?: boolean;
}

function StackedPhotos({ count, label, compact = false }: StackedPhotosProps) {
  return (
    <div className="flex items-center">
      {Array.from({ length: count }, (_, index) => (
        <PhotoPlaceholder
          key={index}
          label={`${label} ${index + 1}`}
          className={cn(
            "w-44.5 shrink-0 rounded-lg border-3 border-paper",
            compact ? "h-22.5" : "h-29",
            index < count - 1 && (compact ? "-mr-6" : "-mr-14.5"),
            TILTS[index % TILTS.length],
          )}
        />
      ))}
    </div>
  );
}
