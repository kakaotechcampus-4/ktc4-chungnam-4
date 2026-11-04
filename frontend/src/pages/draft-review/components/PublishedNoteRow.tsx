import { useState } from "react";

import { revokeDeadlineOf } from "@/api/documents";
import { RevokeNoteButton } from "@/features/documents/RevokeNoteButton";
import { formatDateTime } from "@/lib/datetime";
import { useInterval } from "@/lib/use-interval";

interface PublishedNoteRowProps {
  childId: string;
  childName: string;
  draftId: string;
  version: number;
  /** 활성 게시 회차의 게시 시각. 이 줄은 게시된 알림장만 그립니다. */
  publishedAt: string;
}

// 게시를 마친 날짜 화면의 한 줄입니다. 게시한 원아와, 아직 회수할 수 있으면 회수 버튼을 보여 줍니다.
// Figma에 없는 화면이라 문구와 배치는 정했습니다(게시 확인 모달의 말투를 따랐습니다).
export function PublishedNoteRow({
  childId,
  childName,
  draftId,
  version,
  publishedAt,
}: PublishedNoteRowProps) {
  // 기한은 보고 있는 사이에도 지납니다. 1분마다 지금 시각을 다시 읽어 버튼이 제때 사라지게
  // 합니다(그리는 중에는 Date.now를 부르지 않습니다 — react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), 60_000);

  const deadline = revokeDeadlineOf(publishedAt);
  // 반·날짜 목록에는 서버의 can_revoke가 오지 않아 게시 시각으로 기한만 봅니다. **표시일 뿐
  // 판정이 아닙니다** — 학부모가 이미 열었는지는 여기서 알 수 없고 서버가 409로 막습니다.
  // 알림장 상세는 서버 can_revoke를 그대로 씁니다.
  const withinWindow = deadline !== null && deadline.getTime() > now;

  return (
    <li className="flex items-center justify-between gap-4 rounded-md border border-line bg-canvas px-4 py-3.5">
      {/* 왼쪽은 "누구를 언제 보냈나", 오른쪽은 "언제까지 무엇을 할 수 있나"로 나눕니다. */}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-body font-bold text-ink">{childName}</span>
        <span className="text-caption text-ink-muted">{formatDateTime(publishedAt)} 게시</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-caption text-ink-muted">
          {withinWindow && deadline !== null
            ? `${formatDateTime(deadline.toISOString())}까지`
            : "회수 기한이 지났어요"}
        </span>
        {withinWindow ? (
          <RevokeNoteButton
            childId={childId}
            childName={childName}
            draftId={draftId}
            version={version}
          />
        ) : null}
      </div>
    </li>
  );
}
