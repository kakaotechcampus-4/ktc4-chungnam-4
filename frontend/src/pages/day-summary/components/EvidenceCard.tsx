import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  TEACHER_EVIDENCE_TEXT_MAX_LENGTH,
  classEvidenceQueryOptions,
  evidenceKeys,
  saveTeacherEvidence,
} from "@/api/agents";
import { Button } from "@/components/ui/button";
import type { ClassChildView } from "@/api/organization";
import { cn } from "@/lib/utils";

interface EvidenceCardProps {
  child: ClassChildView;
  recordDate: string;
}

// 추가 근거(Figma 1:3095의 입력 칸). 아이별 하루 확인 안에서 씁니다(#83 리뷰 — 따로 있던 작성 화면을 합침).
// 아이·날짜마다 한 건이고, 이미 있으면 그 내용을 불러와 고치며, 저장하면 덮어씁니다.
export function EvidenceCard({ child, recordDate }: EvidenceCardProps) {
  const queryClient = useQueryClient();
  const evidence = useQuery(classEvidenceQueryOptions(child.class_id, recordDate));
  // 고치기 전에는 저장된 내용을 보여 줍니다. 그래서 초깃값을 null로 둡니다.
  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftTime, setDraftTime] = useState<string | null>(null);
  const saving = useMutation({
    mutationFn: (body: { activity_time: string; text: string }) =>
      saveTeacherEvidence(child.child_id, recordDate, body),
    onSuccess: () => {
      setDraftText(null);
      setDraftTime(null);
      return queryClient.invalidateQueries({
        queryKey: evidenceKeys.classEvidence(child.class_id, recordDate),
      });
    },
  });

  const existing = evidence.data?.find((note) => note.child_id === child.child_id);
  const text = draftText ?? existing?.text ?? "";
  // 서버와 같게 앞뒤 공백을 뺀 글자 수를, 서버(파이썬 len)처럼 코드 포인트 단위로 셉니다. `.length`는
  // UTF-16 단위라 이모지를 두 글자로 세어 서버보다 엄격해집니다. 넘으면 입력은 막지 않고(붙여넣은 글이
  // 조용히 잘리지 않게) 저장만 막습니다.
  const length = [...text.trim()].length;
  const limitLabel = TEACHER_EVIDENCE_TEXT_MAX_LENGTH.toLocaleString("ko-KR");
  const overLimit = length > TEACHER_EVIDENCE_TEXT_MAX_LENGTH;
  // TODO(김동건): 활동 시각 기본값은 스펙에 없습니다. 비워 두면 서버가 받지 못해 지금은 10:30으로 채웁니다.
  const activityTime = draftTime ?? existing?.activity_time ?? "10:30";
  const editing = existing !== undefined;
  // 저장된 근거를 못 받았으면 모르는 채로 덮어쓸 수 있어 저장을 막습니다(#83 리뷰).
  const canSave = evidence.isSuccess && text.trim() !== "" && !overLimit && !saving.isPending;
  const savedNow = saving.isSuccess && draftText === null;

  return (
    <section
      aria-labelledby="evidence-title"
      className="flex flex-col gap-3.5 rounded-xl border border-line bg-paper p-6"
    >
      <div className="flex items-center gap-2">
        <h2 id="evidence-title" className="text-nav font-bold text-ink">
          사진에 담기지 않은 이야기
        </h2>
        {editing ? (
          <span className="rounded-full bg-leaf-soft px-2.5 py-0.5 text-caption font-bold text-brand-ink">
            추가 근거 있음
          </span>
        ) : null}
      </div>
      <p className="text-caption text-ink-muted">
        선생님이 직접 본 일을 적어 주세요. 초안의 문장별 근거로 연결돼요.
      </p>
      <p id="evidence-privacy-help" className="text-caption text-ink-muted">
        학부모 이름·전화번호·주소 같은 개인정보는 적지 마세요.
      </p>
      <p id="evidence-generation-help" className="text-caption text-ink-muted">
        저장한 내용은 다음 AI 생성부터 반영돼요. 이미 만든 초안은 자동으로 바뀌지 않아요.
      </p>

      {evidence.error ? (
        <div role="alert" className="flex flex-col gap-2 text-body text-coral-ink">
          <p>저장된 추가 근거를 불러오지 못했어요. 덮어쓰지 않도록 저장을 막았어요.</p>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void evidence.refetch()}
          >
            다시 불러오기
          </Button>
        </div>
      ) : null}

      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) saving.mutate({ activity_time: activityTime, text: text.trim() });
        }}
      >
        <label className="flex items-center gap-2 text-body text-ink-muted">
          활동 시각 ·
          <input
            type="time"
            value={activityTime}
            onChange={(event) => setDraftTime(event.target.value)}
            className="rounded-xs bg-transparent outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <textarea
          value={text}
          onChange={(event) => setDraftText(event.target.value)}
          aria-label="관찰 내용"
          aria-describedby={`evidence-privacy-help evidence-generation-help${overLimit ? " evidence-length-help" : ""}`}
          aria-invalid={overLimit}
          rows={5}
          disabled={!evidence.isSuccess}
          placeholder="예) 나뭇잎의 모양을 비교하며 “별 모양이야”라고 말했어요."
          className="w-full resize-none rounded-xl bg-brand p-4 text-body text-brand-ink outline-none placeholder:text-brand-ink/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        />
        {/* 글자 수는 보조 표시라 스크린 리더에는 읽히지 않게 두고, 넘었을 때의 안내만 읽어 줍니다. */}
        <p
          aria-hidden="true"
          className={cn(
            "-mt-2 text-right text-caption",
            overLimit ? "font-bold text-destructive" : "text-ink-muted",
          )}
        >
          {length.toLocaleString("ko-KR")} / {limitLabel}자
        </p>
        <p id="evidence-length-help" aria-live="polite" className="text-caption text-destructive">
          {overLimit ? `${limitLabel}자 이하로 줄여 주세요.` : ""}
        </p>
        {/* TODO(김동건): 음성으로 남기기·관련 사진 연결(Figma 1:3095)은 모양이 정해지면 붙입니다. */}
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-caption text-ink-muted">
            {savedNow ? "저장했어요." : null}
            {!savedNow && editing ? "저장하면 남겨 둔 근거가 이 내용으로 바뀌어요." : null}
          </p>
          <Button type="submit" disabled={!canSave}>
            {saving.isPending ? "저장하는 중…" : editing ? "근거 수정" : "근거 저장"}
          </Button>
        </div>
        {saving.error ? (
          <p role="alert" className="text-body text-destructive">
            {saving.error.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
