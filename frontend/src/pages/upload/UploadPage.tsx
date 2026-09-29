// Figma: 1:2296 (자료 올리기)
import { Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ACCEPTED_EXTENSIONS,
  IMPORT_TICK_AMOUNT,
  IMPORT_TICK_MS,
  isImportDone,
  useUploadQueue,
} from "@/features/upload-queue/upload-queue-store";
import { useInterval } from "@/lib/use-interval";
import { cn } from "@/lib/utils";

import { ImportList } from "./components/ImportList";

const GUIDES = [
  {
    title: "사진·영상·음성을 함께 모아요",
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
// TODO(정은): 형식이 안 맞는 파일은 지금 조용히 빠집니다. 업로드 실패 화면(1:2520)과 연결할 때 안내합니다.
export function UploadPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const items = useUploadQueue((state) => state.items);
  const addFiles = useUploadQueue((state) => state.addFiles);
  const advanceImport = useUploadQueue((state) => state.advanceImport);
  const done = isImportDone(items);

  useInterval(
    () => advanceImport(IMPORT_TICK_AMOUNT),
    items.length > 0 && !done ? IMPORT_TICK_MS : null,
  );

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <>
      <PageHeader
        title="오늘의 자료 가져오기"
        subtitle="사진·영상·녹음 파일을 이 기기로 불러와 주세요. 분류 결과를 확인한 뒤 선택한 자료를 전송해요."
      />
      <div className="flex items-start gap-5.5 pb-11">
        <div className="flex min-w-0 flex-1 flex-col gap-5.5">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "flex flex-col items-center rounded-xl border-2 border-dashed border-brand-ink bg-paper p-10.5 text-center",
              dragging && "bg-tint-2",
            )}
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-leaf-soft text-brand-ink">
              <Upload aria-hidden="true" className="size-6.5" />
            </span>
            <p className="pt-4.5 text-h3 font-bold text-ink">여기에 끌어다 놓으세요</p>
            <p className="pt-2 text-label whitespace-pre text-ink-muted">
              {"사진 JPG·PNG·HEIC  ·  영상 MP4·MOV  ·  녹음 M4A·WAV"}
            </p>
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
            disabled={!done}
            onClick={() => navigate("/t/today/processing")}
          >
            불러오기 완료 후 분류 시작
          </Button>
        </aside>
      </div>
    </>
  );
}
