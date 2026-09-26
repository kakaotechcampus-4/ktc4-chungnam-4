// Figma: 1:2406 (오늘의 기록 · 업로드 중), 후보 A 1:2450
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { classChildrenQueryOptions } from "@/api/organization";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { formatDate, kstToday } from "@/lib/datetime";
import { cn } from "@/lib/utils";

interface UploadCount {
  done: number;
  total: number;
}

interface TodayUploadingProps {
  teacherName: string;
  photos: UploadCount;
  videos: UploadCount;
  audios: UploadCount;
  onView: () => void;
  onCancel: () => void;
}

// FR-15. 서버 전송 전, 이 기기(IndexedDB)로 불러오는 단계입니다. 사진만 온디바이스로 처리하므로 큰 숫자와 막대는 사진 기준입니다.
// TODO(정은): 업로드 큐(Zustand) PR에서 TodayPage에 연결합니다. 진행 값은 지금 props로만 받습니다.
export function TodayUploading({
  teacherName,
  photos,
  videos,
  audios,
  onView,
  onCancel,
}: TodayUploadingProps) {
  const { currentClass } = useCurrentClass();
  const { data: children } = useQuery({
    ...classChildrenQueryOptions(currentClass?.class_id ?? ""),
    enabled: currentClass !== null,
  });
  const percent = photos.total === 0 ? 0 : Math.round((photos.done / photos.total) * 100);

  return (
    <div className="flex flex-col gap-5.5 pt-10 pb-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-bold text-ink">안녕하세요, {teacherName} 선생님</h1>
          <p className="text-label text-ink-muted">{formatDate(kstToday())}</p>
        </div>
        {currentClass ? (
          <p className="rounded-full border border-line bg-paper px-4 py-1.75 text-label text-ink">
            {`${currentClass.age_group} ${currentClass.name}`}
            {children ? ` · ${children.length}명` : null}
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-5.5 rounded-2xl bg-paper px-9 py-8">
        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-2.5 font-bold">
            <h2 className="text-h3 text-ink">이 기기로 불러오는 중이에요</h2>
            <p className="text-lead text-ink-muted">
              사진 {photos.total}장 중 {photos.done}장
            </p>
          </div>
          <p className="flex items-baseline gap-1 font-bold">
            <span className="text-h1 text-ink">{percent}</span>
            <span className="text-h3 text-ink-muted">%</span>
          </p>
        </div>

        <div
          role="progressbar"
          aria-label="사진 불러오기"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-soft"
        >
          <div className="h-full rounded-full bg-ink" style={{ width: `${percent}%` }} />
        </div>

        <div className="flex items-center gap-2.5">
          <CountChip label="사진" unit="장" count={photos} />
          <CountChip label="영상" unit="개" count={videos} />
          <CountChip label="녹음" unit="개" count={audios} />
          <Button
            variant="ghost"
            size="lg"
            className="ml-auto text-nav text-brand-ink"
            onClick={onView}
          >
            보러 가기
            <ChevronRight />
          </Button>
        </div>

        <p className="text-body text-ink-muted">
          분류 결과를 확인한 뒤 선택한 자료를 전송해요. 불러오기가 끝날 때까지 창을 열어 두세요.
        </p>
        <Button size="lg" className="w-55" onClick={onCancel}>
          취소하고 돌아가기
        </Button>
      </section>
    </div>
  );
}

interface CountChipProps {
  label: string;
  unit: string;
  count: UploadCount;
}

function CountChip({ label, unit, count }: CountChipProps) {
  const finished = count.done >= count.total;
  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-lg bg-tint-2 px-4 py-2.25 text-body font-bold",
        finished ? "text-brand-ink" : "text-ink",
      )}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      {finished
        ? `${label} ${count.total}${unit} 완료`
        : `${label} ${count.done} / ${count.total}${unit} 불러오는 중`}
    </p>
  );
}
