// Figma: 1:1945
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import { childQueryOptions, regenerateChildInvite } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// FR-28, #225: 토큰은 해시만 보관하므로 발급한 화면에서만 복사할 수 있습니다.

const EYEBROW = "우리 반 관리 / 학부모 연결";
const TITLE = "학부모 초대 링크";
const MASK = "••••••••";

type CopyState = "idle" | "copied" | "failed";

/** 성을 뺀 이름. "박서아" → "서아". 한 글자면 그대로 둡니다 */
function givenName(name: string) {
  const chars = Array.from(name);
  return chars.length >= 2 ? chars.slice(1).join("") : name;
}

/** 초대 링크는 토큰을 가려 보여 줍니다. "https://aidam.test/invite/abc" → "aidam.test/invite/••••••••" */
function maskInviteUrl(inviteUrl: string) {
  try {
    const url = new URL(inviteUrl);
    const segments = url.pathname.split("/").filter(Boolean).slice(0, -1);
    return [url.host, ...segments, MASK].join("/");
  } catch {
    return MASK;
  }
}

export function ChildInviteLinkPage() {
  const { childId = "" } = useParams();
  const childQuery = useQuery(childQueryOptions(childId));
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const regenerate = useMutation({
    mutationFn: () => regenerateChildInvite(childId),
    onSuccess: () => setCopyState("idle"),
  });

  const child = childQuery.data;
  const invite = regenerate.data;
  const subtitle = child ? `${child.name} · ${child.class_name}` : undefined;

  async function copyLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(new URL(invite.invite_url, window.location.origin).href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const error = childQuery.error;

  return (
    <>
      <PageHeader eyebrow={EYEBROW} title={TITLE} subtitle={subtitle} />
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error.message}
        </p>
      ) : !child ? (
        <p role="status" className="text-body text-ink-muted">
          초대 링크를 불러오고 있어요.
        </p>
      ) : (
        <div className="pb-10">
          <FocusCard
            className="min-h-140 justify-between"
            footer={
              <>
                <Button className="w-57.5" onClick={copyLink} disabled={!invite}>
                  {copyState === "copied" ? "복사했어요" : "초대 링크 복사"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="w-57.5" disabled={regenerate.isPending}>
                      {invite ? "링크 다시 만들기" : "초대 링크 만들기"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {invite ? "링크를 다시 만들까요?" : "초대 링크를 만들까요?"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        링크는 7일 동안 한 번만 사용할 수 있어요. 새로 만들면 이전 링크는 무효가
                        됩니다.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction onClick={() => regenerate.mutate()}>
                        {invite ? "다시 만들기" : "만들기"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            }
          >
            <div className="flex flex-col gap-5">
              <h2 className="text-h3 font-bold text-ink">
                {givenName(child.name)}의 보호자를 초대해요
              </h2>
              <p className="text-nav text-ink-muted">
                이 아이의 알림장을 확인할 보호자에게 링크를 전달해 주세요.
              </p>
              <p className="text-lead font-bold text-ink">
                {invite
                  ? maskInviteUrl(new URL(invite.invite_url, window.location.origin).href)
                  : "아래 버튼으로 초대 링크를 만들어 주세요."}
              </p>
              <p className="flex gap-3 text-body text-ink-muted">
                <span>연결 상태</span>
                <span aria-hidden="true">·</span>
                <span>
                  {child.parent_linked ? "보호자가 연결됐어요" : "아직 연결된 보호자가 없어요"}
                </span>
              </p>
              <p className="text-label text-ink-muted">
                링크는 7일 동안 한 번만 사용할 수 있어요. 새로 만들면 이전 링크는 무효가 됩니다.
              </p>
              {copyState === "copied" ? (
                <p role="status" className="text-label text-brand-ink">
                  초대 링크를 복사했어요. 보호자에게 전달해 주세요.
                </p>
              ) : null}
              {copyState === "failed" ? (
                <p role="alert" className="text-label text-destructive">
                  링크를 복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.
                </p>
              ) : null}
              {regenerate.isSuccess ? (
                <p role="status" className="text-label text-brand-ink">
                  새 링크를 만들었어요.
                </p>
              ) : null}
              {regenerate.isError ? (
                <p role="alert" className="text-label text-destructive">
                  {regenerate.error.message}
                </p>
              ) : null}
            </div>
          </FocusCard>
        </div>
      )}
    </>
  );
}
