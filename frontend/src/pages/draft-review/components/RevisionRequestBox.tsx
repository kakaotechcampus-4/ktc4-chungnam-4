import { useState } from "react";

import { DRAFT_REVISION_MAX_LENGTH } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";

interface RevisionRequestBoxProps {
  /** 이 초안에 AI 요청을 보낼 수 있는지 막는 이유. null이면 열려 있습니다(상태·수정 중 등은 부모가 판정). */
  lockedReason: string | null;
  /** 요청이 진행 중인가. 최대 1분쯤 걸립니다. */
  pending: boolean;
  /** 이 요청 말고 다른 저장·승인이 진행 중인가. 같은 버전을 쓰는 두 저장이 겹치지 않게 잠급니다. */
  otherBusy: boolean;
  /** 마지막 요청의 오류 */
  error: Error | null;
  /** 마지막 성공에서 바뀐 문장 수. null이면 안내하지 않습니다. */
  changedCount: number | null;
  /** 요청합니다. 실패하면 reject — 오류 문구는 `error`로 다시 내려옵니다. */
  onSubmit: (instruction: string) => Promise<unknown>;
}

// 이 UI는 Figma 노드가 없습니다(docs/api/screens.md). 임시 디자인이라 팀 확정 전에 바뀔 수 있습니다.

/** "AI가 다듬음" 표시. 초안 문장 옆에 붙입니다(임시 디자인). */
export function RevisedBadge() {
  return (
    <span className="mr-1.5 rounded-sm bg-brand px-1.5 py-0.5 align-middle text-caption font-bold text-brand-ink">
      AI가 다듬음
    </span>
  );
}

export function RevisionRequestBox({
  lockedReason,
  pending,
  otherBusy,
  error,
  changedCount,
  onSubmit,
}: RevisionRequestBoxProps) {
  const [instruction, setInstruction] = useState("");
  const length = instruction.trim().length;
  const tooLong = length > DRAFT_REVISION_MAX_LENGTH;
  const empty = length === 0;
  const inputDisabled = lockedReason !== null || pending;
  const canSubmit = !inputDisabled && !otherBusy && !empty && !tooLong;

  async function submit() {
    try {
      await onSubmit(instruction);
      setInstruction("");
    } catch {
      // 실패 문구는 error로 내려옵니다. 지시문은 지우지 않아 바로 다시 요청할 수 있습니다.
    }
  }

  // 서버가 준 문구를 그대로 보여 줍니다. 버전이 밀린 경우에만 다음 행동을 덧붙입니다.
  const conflict = error instanceof ApiError && error.code === "DRAFT_VERSION_CONFLICT";
  const reason =
    lockedReason ??
    (otherBusy && !pending
      ? "저장하는 중이에요."
      : tooLong
        ? "500자 이내로 써 주세요."
        : empty && !pending
          ? "요청할 내용을 적어 주세요."
          : null);

  return (
    <section
      aria-label="AI에게 다듬기 요청"
      className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-5"
    >
      <label htmlFor="revision-instruction" className="text-body font-bold text-ink">
        AI에게 다듬기 요청
      </label>
      <Textarea
        id="revision-instruction"
        value={instruction}
        rows={2}
        disabled={inputDisabled}
        placeholder="예) 놀이 모습을 더 구체적으로 써 주세요"
        onChange={(event) => setInstruction(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-ink-muted">
          직접 고친 문장은 그대로 두고, 다듬은 결과도 교사가 승인해야 학부모에게 공개돼요.
        </p>
        <span
          className={tooLong ? "text-caption text-destructive" : "text-caption text-ink-muted"}
          aria-label="글자 수"
        >
          {length}/{DRAFT_REVISION_MAX_LENGTH}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Button className="self-start" disabled={!canSubmit} onClick={() => void submit()}>
          AI에게 요청
        </Button>
        {reason ? <p className="text-caption text-ink-muted">{reason}</p> : null}
      </div>
      {pending ? (
        <p role="status" className="text-caption text-ink-muted">
          AI가 문장을 다듬고 있어요. 최대 1분쯤 걸려요.
        </p>
      ) : changedCount !== null ? (
        <p role="status" className="text-caption text-ink">
          {changedCount > 0
            ? `${String(changedCount)}개 문장을 다듬었어요`
            : "바꿀 문장이 없었어요"}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요."}
          {conflict ? " 최신 내용을 다시 불러왔어요. 확인한 뒤 다시 요청해 주세요." : ""}
        </p>
      ) : null}
    </section>
  );
}
