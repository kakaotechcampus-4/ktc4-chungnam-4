// Figma: 1:2296 (자료 올리기)
import { UPLOAD_GUIDE } from "@/features/upload-queue/media-capabilities";
import { Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ACCEPTED_EXTENSIONS,
  isImportDone,
  useUploadQueue,
} from "@/features/upload-queue/upload-queue-store";
import { useImportTicker } from "@/features/upload-queue/use-import-ticker";
import { cn } from "@/lib/utils";
import { isDateOnly, kstToday } from "@/lib/datetime";

import { ImportList } from "./components/ImportList";
import { RejectedList } from "./components/RejectedList";

const GUIDES = [
  {
    title: "오늘의 활동 자료를 모아요",
    body: "자료를 불러온 뒤 처리 단계와 진행률을 확인할 수 있어요.",
  },
  {
    title: "아이별 자료를 직접 확인해요",
    body: "잘못 연결된 사진과 발화를 바꾸거나 제외할 수 있어요.",
  },
  {
    title: "확인한 내용으로 초안을 만들어요",
    body: "초안을 검토하고 승인한 뒤 보호자에게 게시해요.",
  },
];

// FR-15. 고른 자료를 이 기기로 불러옵니다. 서버로는 아직 보내지 않습니다 — 교사가 확인한 것만 처리 중 화면에서 보냅니다(H-3).
// 형식이 안 맞는 파일은 담지 않고 드롭존 아래에 이름을 알려 줍니다.
export function UploadPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const items = useUploadQueue((state) => state.items);
  const recordDate = useUploadQueue((state) => state.recordDate);
  const setRecordDate = useUploadQueue((state) => state.setRecordDate);
  const rejected = useUploadQueue((state) => state.rejected);
  const addFiles = useUploadQueue((state) => state.addFiles);
  const removeRejected = useUploadQueue((state) => state.removeRejected);
  const done = isImportDone(items);

  useImportTicker();

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <>
      <PageHeader title="오늘의 자료 가져오기" subtitle={UPLOAD_GUIDE} />
      <div className="flex items-start gap-5.5 pb-11">
        <div className="flex min-w-0 flex-1 flex-col gap-5.5">
          <label className="flex items-center gap-3 text-label font-bold text-ink">
            활동 날짜
            <input
              type="date"
              value={recordDate}
              max={kstToday()}
              onChange={(event) => {
                if (isDateOnly(event.target.value)) setRecordDate(event.target.value);
              }}
              className="rounded-md border border-line bg-paper px-3 py-2 outline-none transition-shadow focus-visible:border-brand-ink focus-visible:ring-3 focus-visible:ring-brand-ink/20"
            />
            <span className="text-caption font-normal text-ink-muted">
              선택한 날짜의 알림장에 사용할 자료를 골라 주세요.
            </span>
          </label>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            // 파일을 끌고 들어오면 색이 바뀌며 살짝 커져, 여기에 놓으면 담긴다는 것을 보여 줍니다.
            className={cn(
              "flex flex-col items-center rounded-xl border-2 border-dashed border-brand-ink bg-paper p-10.5 text-center transition duration-200 ease-soft",
              dragging && "bg-tint-2 motion-safe:scale-101",
            )}
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-leaf-soft text-brand-ink">
              <Upload aria-hidden="true" className="size-6.5" />
            </span>
            <p className="pt-4.5 text-h3 font-bold text-ink">여기에 끌어다 놓으세요</p>
            <p className="pt-2 text-label whitespace-pre text-ink-muted">{UPLOAD_GUIDE}</p>
            <Button variant="solid" className="mt-5.5" onClick={() => inputRef.current?.click()}>
              폴더에서 고르기
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_EXTENSIONS}
              aria-label="자료 파일 선택"
              className="hidden"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                // 같은 파일을 다시 골라도 onChange가 오게 비웁니다.
                event.target.value = "";
              }}
            />
          </div>

          {rejected.length > 0 ? (
            <RejectedList fileNames={rejected} onRemove={removeRejected} />
          ) : null}
          {items.length > 0 ? <ImportList items={items} /> : null}
        </div>

        <aside className="flex w-85 shrink-0 flex-col gap-4 rounded-xl border border-line bg-paper p-5.5">
          <h2 className="text-lead font-bold text-ink">자료는 이렇게 정리돼요</h2>
          <ul className="flex flex-col gap-2.5">
            {GUIDES.map((guide) => (
              <li
                key={guide.title}
                className="flex flex-col gap-1.75 rounded-xl bg-canvas px-4 py-3.75"
              >
                <p className="flex items-center gap-2 text-label font-bold text-ink">
                  <span aria-hidden="true" className="size-1.75 rounded-full bg-brand-ink" />
                  {guide.title}
                </p>
                <p className="text-caption font-bold text-ink-muted">{guide.body}</p>
              </li>
            ))}
          </ul>
          <Button
            variant="solid"
            className="w-full"
            disabled={!done || recordDate > kstToday()}
            onClick={() => navigate("/t/today/processing")}
          >
            불러오기 완료 후 분류 시작
          </Button>
        </aside>
      </div>
    </>
  );
}
