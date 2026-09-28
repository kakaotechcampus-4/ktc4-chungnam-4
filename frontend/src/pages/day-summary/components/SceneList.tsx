import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Scene {
  id: string;
  time: string;
  activity: string;
  text: string;
  meta: string;
}

interface SceneListProps {
  scenes: readonly Scene[];
  /** 예: "사진 12장 · 멘트 4개에서 모았어요" */
  sourceLabel: string;
  excluded: ReadonlySet<string>;
  onToggleExcluded: (sceneId: string) => void;
  /** 틀린 장면이나 빠진 일을 피드백 칸에 적도록 넘깁니다. */
  onFeedback: (prefix: string) => void;
}

// 하루 정리 카드입니다(Figma 1:3115 왼쪽 위). 뺀 장면은 흐리게 두고 되돌릴 수 있게 합니다.
export function SceneList({
  scenes,
  sourceLabel,
  excluded,
  onToggleExcluded,
  onFeedback,
}: SceneListProps) {
  return (
    <section
      aria-labelledby="scene-list-title"
      className="rounded-xl border border-line bg-paper p-6.5"
    >
      <div className="flex items-center gap-3">
        <h2 id="scene-list-title" className="text-lead font-bold text-ink">
          하루 정리
        </h2>
        <span className="rounded-full bg-neutral-soft px-2.5 py-1 text-caption font-bold text-ink">
          장면 {scenes.length}개
        </span>
        <p className="ml-auto text-caption font-bold text-ink-muted">{sourceLabel}</p>
      </div>

      <ol>
        {scenes.map((scene) => {
          const isExcluded = excluded.has(scene.id);
          return (
            <li key={scene.id} className="flex gap-4 border-b border-line py-4.5">
              <div className="flex w-26 shrink-0 flex-col items-start gap-1.5">
                <time
                  className={cn(
                    "text-label font-bold",
                    isExcluded ? "text-ink-muted" : "text-brand-ink",
                  )}
                >
                  {scene.time}
                </time>
                <span className="rounded-full bg-neutral-soft px-2.5 py-1 text-caption font-bold text-ink">
                  {scene.activity}
                </span>
              </div>
              <div className={cn("flex flex-1 flex-col gap-2", isExcluded && "text-ink-muted")}>
                <p className={cn("text-nav leading-relaxed", !isExcluded && "text-ink")}>
                  {isExcluded ? <span className="sr-only">(뺀 장면) </span> : null}
                  {scene.text}
                </p>
                <p className="text-caption font-bold text-ink-muted">{scene.meta}</p>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                {isExcluded ? (
                  <>
                    <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-caption font-bold text-destructive">
                      뺐어요
                    </span>
                    <Button variant="outline" size="sm" onClick={() => onToggleExcluded(scene.id)}>
                      되돌리기
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onFeedback(`${scene.time} ${scene.activity}: `)}
                    >
                      틀렸어요
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => onToggleExcluded(scene.id)}
                    >
                      빼기
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => onFeedback("이런 일도 있었어요: ")}
        className="mt-4.5 flex w-full items-center gap-2.5 rounded-md border border-dashed border-line px-4.5 py-4 text-label font-bold text-ink-muted outline-none hover:bg-tint-2 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Plus aria-hidden="true" className="size-4" />
        빠진 일이 있으면 알려주세요
      </button>
    </section>
  );
}
