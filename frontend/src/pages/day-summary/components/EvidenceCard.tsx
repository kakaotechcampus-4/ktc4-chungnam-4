import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { classEvidenceQueryOptions, evidenceKeys, saveTeacherEvidence } from "@/api/agents";
import { Button } from "@/components/ui/button";
import type { ClassChild } from "@/types/api-draft/organization";

interface EvidenceCardProps {
  child: ClassChild;
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
  // TODO(김동건): 활동 시각 기본값은 스펙에 없습니다. 비워 두면 서버가 받지 못해 지금은 10:30으로 채웁니다.
  const activityTime = draftTime ?? existing?.activity_time ?? "10:30";
  const editing = existing !== undefined;
  // 저장된 근거를 못 받았으면 모르는 채로 덮어쓸 수 있어 저장을 막습니다(#83 리뷰).
  const canSave = evidence.isSuccess && text.trim() !== "" && !saving.isPending;
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
          rows={5}
          disabled={!evidence.isSuccess}
          placeholder="예) 나뭇잎의 모양을 비교하며 “별 모양이야”라고 말했어요."
          className="w-full resize-none rounded-xl bg-brand p-4 text-body text-brand-ink outline-none placeholder:text-brand-ink/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        />
        {/* TODO(김동건): 음성으로 남기기·관련 사진 연결(Figma 1:3095)은 모양이 정해지면 붙입니다. */}
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-caption text-ink-muted">
            {savedNow ? "저장했어요." : null}
            {!savedNow && editing ? "저장하면 오늘 남긴 근거가 이 내용으로 바뀌어요." : null}
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
