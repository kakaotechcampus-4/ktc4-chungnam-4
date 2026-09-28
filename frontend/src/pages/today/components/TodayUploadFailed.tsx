// Figma: 1:2520 (업로드 실패 · 재시도), 후보 A 1:2557
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Figma에 있는 두 가지 이유만 둡니다. 나머지는 업로드 큐 PR에서 정합니다.
 * unsupported는 브라우저가 서버에 보내기 전에 거른 파일입니다. upload-urls는 한 건만 형식이 틀려도 요청 전체를 거절합니다(MEDIA_TYPE_NOT_ALLOWED).
 */
export type UploadFailureReason = "network" | "unsupported";

export interface UploadFailure {
  fileName: string;
  reason: UploadFailureReason;
}

interface TodayUploadFailedProps {
  total: number;
  failures: UploadFailure[];
  onRetryAll: () => void;
  onRetry: (failure: UploadFailure) => void;
  onRemove: (failure: UploadFailure) => void;
  onViewCompleted: () => void;
  onPickMore: () => void;
}

const REASON_LABEL: Record<UploadFailureReason, string> = {
  network: "연결 끊김",
  unsupported: "지원하지 않는 형식",
};

function causeText(networkCount: number, unsupportedCount: number) {
  const network = `연결이 끊겨 ${networkCount}개를 올리지 못했`;
  const unsupported = `${unsupportedCount}개는 지원하지 않는 형식이에요.`;
  if (networkCount > 0 && unsupportedCount > 0) return `${network}고, ${unsupported}`;
  return networkCount > 0 ? `${network}어요.` : unsupported;
}

const actionClass =
  "rounded-xs text-nav outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

// FR-15. 완료된 자료는 두고 실패한 파일만 다시 올립니다. 형식이 안 맞는 파일은 다시 시도해도 실패하므로 제외만 둡니다.
// TODO(정은): 업로드 큐(Zustand) PR에서 TodayPage에 연결합니다. 지금은 props로만 그립니다.
export function TodayUploadFailed({
  total,
  failures,
  onRetryAll,
  onRetry,
  onRemove,
  onViewCompleted,
  onPickMore,
}: TodayUploadFailedProps) {
  const done = total - failures.length;
  const networkCount = failures.filter((failure) => failure.reason === "network").length;
  const unsupportedCount = failures.length - networkCount;

  return (
    <>
      <PageHeader
        eyebrow="자료 올리기 / 업로드 결과"
        title="올리지 못한 파일이 있어요"
        subtitle="완료된 자료는 유지하고, 실패한 파일만 다시 올릴 수 있어요."
      />
      <div className="mx-25 flex flex-col gap-8 pb-11">
        <section className="flex flex-col gap-3.5 rounded-xl bg-paper p-8">
          <h2 className="text-h3 font-bold text-ink">
            {total}개 중 {done}개 완료 · {failures.length}개 확인 필요
          </h2>
          <p className="text-nav text-ink-muted">{causeText(networkCount, unsupportedCount)}</p>
          <div className="flex items-center gap-6">
            {networkCount > 0 ? (
              <Button size="lg" onClick={onRetryAll}>
                실패한 {networkCount}개만 다시 시도
              </Button>
            ) : null}
            <button
              type="button"
              className={cn(actionClass, "text-body text-brand-ink")}
              onClick={onViewCompleted}
            >
              {`완료된 ${done}개 확인하기  →`}
            </button>
          </div>
        </section>

        <div className="flex flex-col gap-5.5 px-6">
          <table className="w-full text-left">
            <thead className="text-label text-ink-muted">
              <tr>
                <th className="w-100 pb-3 font-normal">파일</th>
                <th className="w-67.5 pb-3 font-normal">실패 이유</th>
                <th className="pb-3 font-normal">할 수 있는 일</th>
              </tr>
            </thead>
            <tbody className="text-nav text-ink">
              {failures.map((failure) => (
                <tr key={failure.fileName}>
                  <td className="py-3">{failure.fileName}</td>
                  <td className="py-3">{REASON_LABEL[failure.reason]}</td>
                  <td className="py-3">
                    {failure.reason === "network" ? (
                      <button
                        type="button"
                        aria-label={`${failure.fileName} 다시 시도`}
                        className={cn(actionClass, "font-bold text-ink")}
                        onClick={() => onRetry(failure)}
                      >
                        다시 시도
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`${failure.fileName} 목록에서 제외`}
                        className={cn(actionClass, "text-ink-muted")}
                        onClick={() => onRemove(failure)}
                      >
                        목록에서 제외
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className={cn(actionClass, "self-start text-body font-bold whitespace-pre text-ink")}
            onClick={onPickMore}
          >
            {"다른 파일 선택하기  +"}
          </button>
        </div>
      </div>
    </>
  );
}
