// Figma: 1:3095 (추출본 Untitled 1:1964)
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import {
  findSampleChild,
  SAMPLE_CHILDREN,
  SAMPLE_DATE_LABEL,
} from "@/features/classify/sample-data";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";

const BACK_TO = "/t/today/classification";

export function EvidenceNewPage() {
  const { childId } = useParams();
  const child = findSampleChild(childId);
  const navigate = useNavigate();
  const [targetId, setTargetId] = useState(child?.id ?? "");
  const [note, setNote] = useState("");

  // 주소의 아이가 명단에 없으면(오타, 다른 반 아이) 빈 폼 대신 404를 보여 줍니다.
  if (!child) return <NotFoundPage />;

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="오늘의 기록 / 추가 근거"
        title="사진에 담기지 않은 이야기도 남겨요"
        subtitle={`${child.name} · ${SAMPLE_DATE_LABEL}`}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          // TODO(김동건): 근거 저장 API가 정해지면 저장한 뒤 이동합니다. 지금은 이동만 합니다.
          navigate(BACK_TO);
        }}
      >
        <FocusCard
          className="min-h-140"
          footer={
            <>
              <Button asChild className="w-45 border-transparent">
                <Link to={BACK_TO}>취소</Link>
              </Button>
              <Button type="submit" className="w-57.5 border-transparent" disabled={!note.trim()}>
                근거 저장
              </Button>
            </>
          }
        >
          <div className="flex flex-1 flex-col justify-between gap-5">
            <h2 className="text-h3 font-bold text-ink">교사가 직접 관찰한 내용</h2>

            <div className="flex gap-7 text-body text-ink-muted">
              <label className="flex items-center gap-2">
                연결할 아이 ·
                <span className="relative flex items-center">
                  <select
                    value={targetId}
                    onChange={(event) => setTargetId(event.target.value)}
                    className="appearance-none rounded-xs bg-transparent pr-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {SAMPLE_CHILDREN.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    strokeWidth={2.5}
                    className="pointer-events-none absolute right-0 size-2.5"
                  />
                </span>
              </label>
              <label className="flex items-center gap-2">
                활동 시각 ·
                <input
                  type="time"
                  defaultValue="10:30"
                  className="rounded-xs bg-transparent outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
            </div>

            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label="관찰 내용"
              placeholder="예) 나뭇잎의 모양을 비교하며 “별 모양이야”라고 말했어요."
              className="h-42 w-full resize-none rounded-xl bg-brand p-5 text-lead text-brand-ink outline-none placeholder:text-brand-ink/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            />

            {/* TODO(김동건): 음성 메모와 사진 연결은 업로드 흐름이 정해지면 붙입니다. */}
            <div className="flex items-center gap-4 text-body font-bold text-ink">
              <button type="button" disabled className="disabled:opacity-40">
                음성으로 남기기
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" disabled className="disabled:opacity-40">
                관련 사진 연결하기
              </button>
            </div>

            <p className="text-body text-ink-muted">저장한 내용은 초안의 문장별 근거로 연결돼요.</p>
          </div>
        </FocusCard>
      </form>
    </div>
  );
}
