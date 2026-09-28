import { Camera, FileText, Play } from "lucide-react";

import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { cn } from "@/lib/utils";

export interface Quote {
  id: string;
  source: "audio" | "photo";
  label: string;
  text: string;
}

interface EvidencePanelProps {
  quotes: readonly Quote[];
  /** 모은 멘트 전체 수. 카드는 일부만 보여 줄 수 있어 따로 받습니다(Figma: 카드 3장, 멘트 4개). */
  quoteTotal: number;
  /** 썸네일 3장 뒤에 "+N"으로 보이는 나머지 사진 수 */
  morePhotoCount: number;
}

const OUTPUTS = [
  { title: "관찰일지", detail: "격식체 · 누리과정 영역 태그" },
  { title: "알림장", detail: "학부모용 · 다정한 톤" },
];

// 오른쪽 근거 패널입니다(Figma 1:3115 오른쪽). 장면이 어떤 멘트·사진에서 나왔는지 보여 줍니다.
export function EvidencePanel({ quotes, quoteTotal, morePhotoCount }: EvidencePanelProps) {
  return (
    <div className="flex w-85 shrink-0 flex-col gap-4.5">
      <section
        aria-labelledby="evidence-title"
        className="flex flex-col gap-2.5 rounded-xl border border-line bg-paper p-6"
      >
        <div className="flex items-center">
          <h2 id="evidence-title" className="text-lead font-bold text-ink">
            어디서 나왔나
          </h2>
          <span className="ml-auto rounded-full bg-neutral-soft px-2.5 py-1 text-caption font-bold text-ink">
            멘트 {quoteTotal}개
          </span>
        </div>
        <ul className="flex flex-col gap-2.5">
          {quotes.map((quote) => {
            const Icon = quote.source === "audio" ? Play : Camera;
            return (
              <li
                key={quote.id}
                className="flex flex-col gap-2.5 rounded-xl border border-line p-3.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md text-brand-ink",
                      quote.source === "audio" ? "bg-brand" : "bg-leaf-soft",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <p className="text-caption font-bold text-ink">{quote.label}</p>
                  {/* TODO(김동건): 발화 구간 재생은 미디어 API가 정해지면 붙입니다. */}
                  <button
                    type="button"
                    disabled
                    className="ml-auto text-caption font-bold text-brand-ink disabled:opacity-60"
                  >
                    3초 재생
                  </button>
                </div>
                <p className="text-label text-ink">{quote.text}</p>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2">
          {[1, 2, 3].map((n) => (
            <PhotoPlaceholder key={n} label={`근거 사진 ${n}`} className="size-13 rounded-md" />
          ))}
          <span className="flex size-13 items-center justify-center rounded-md bg-neutral-soft text-caption font-bold text-ink-muted">
            +{morePhotoCount}
            <span className="sr-only">장 더 있음</span>
          </span>
        </div>
      </section>

      <section
        aria-labelledby="outputs-title"
        className="flex flex-col gap-3 rounded-xl border border-line bg-neutral-soft p-5.5"
      >
        <h2 id="outputs-title" className="text-label font-bold text-ink">
          다음에 만들 것
        </h2>
        <ul className="flex flex-col gap-3">
          {OUTPUTS.map((output) => (
            <li
              key={output.title}
              className="flex gap-2.5 rounded-xl border border-line bg-paper px-3.5 py-3"
            >
              <FileText aria-hidden="true" className="mt-0.5 size-4 text-ink-muted" />
              <div className="flex flex-col gap-0.5 font-bold">
                <p className="text-label text-ink">{output.title}</p>
                <p className="text-caption text-ink-muted">{output.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-caption font-bold text-ink-muted">
          초안을 승인하기 전까지는 학부모에게 보이지 않습니다.
        </p>
      </section>
    </div>
  );
}
