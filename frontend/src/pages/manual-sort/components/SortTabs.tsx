import { Link } from "react-router";

import { cn } from "@/lib/utils";

export type SortTab = "photo" | "speech";

interface SortTabsProps {
  active: SortTab;
  photoCount: number;
  speechCount: number;
  processed: number;
  total: number;
}

// 수동 분류 위쪽의 사진 / 발화 탭(Figma 1:3037·1:3064). 탭은 주소(?tab=speech)에 둡니다.
export function SortTabs({ active, photoCount, speechCount, processed, total }: SortTabsProps) {
  const tabs = [
    { key: "photo" as const, to: "/t/today/manual-sort", label: `사진 ${photoCount}장` },
    {
      key: "speech" as const,
      to: "/t/today/manual-sort?tab=speech",
      label: `발화 ${speechCount}개`,
    },
  ];
  return (
    <div className="flex items-start gap-6">
      <nav aria-label="분류할 자료 종류" className="flex gap-6">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            to={tab.to}
            aria-current={active === tab.key ? "page" : undefined}
            className={cn(
              "flex h-12 w-40 items-center justify-center rounded-md border text-body font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active === tab.key
                ? "border-brand-border bg-brand text-brand-ink"
                : "border-transparent bg-tint-2 text-ink hover:bg-brand",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <p className="text-body text-ink-muted">
        처리 {processed} / {total}개
      </p>
    </div>
  );
}
