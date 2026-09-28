// Figma: 1:1945
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import {
  childInviteQueryOptions,
  childQueryOptions,
  organizationKeys,
  regenerateChildInvite,
} from "@/api/organization";
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

// TODO(이한나): ⛔ #39 초대 링크의 발급 주체·형식·만료가 정해지지 않았습니다. 정해지면 문구와 동작을 맞춥니다.

const EYEBROW = "우리 반 관리 / 학부모 연결";
const TITLE = "학부모 초대 링크";
const MASK = "••••••••";

type CopyState = "idle" | "copied" | "failed";

/** 성을 뺀 이름. "박서아" → "서아". 한 글자면 그대로 둡니다 */
function givenName(name: string) {
  const chars = Array.from(name);
  return chars.length >= 2 ? chars.slice(1).join("") : name;
}

/** 초대 링크는 토큰을 가려 보여 줍니다. "https://idam.app/invite/abc" → "idam.app/invite/••••••••" */
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
  const queryClient = useQueryClient();
  const childQuery = useQuery(childQueryOptions(childId));
  const inviteQuery = useQuery(childInviteQueryOptions(childId));
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const regenerate = useMutation({
    mutationFn: () => regenerateChildInvite(childId),
    onSuccess: async () => {
      setCopyState("idle");
      await queryClient.invalidateQueries({ queryKey: organizationKeys.childInvite(childId) });
    },
  });

  const child = childQuery.data;
  const invite = inviteQuery.data;
  const subtitle = child ? `${child.name} · ${child.class_name}` : undefined;

  async function copyLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.invite_url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const error = childQuery.error ?? inviteQuery.error;

  return (
    <>
      <PageHeader eyebrow={EYEBROW} title={TITLE} subtitle={subtitle} />
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error.message}
        </p>
      ) : !child || !invite ? (
        <p role="status" className="text-body text-ink-muted">
          초대 링크를 불러오고 있어요.
        </p>
      ) : (
        <div className="pb-10">
          <FocusCard
            className="min-h-140 justify-between"
            footer={
              <>
                <Button className="w-57.5" onClick={copyLink}>
                  {copyState === "copied" ? "복사했어요" : "초대 링크 복사"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="w-57.5" disabled={regenerate.isPending}>
                      링크 다시 만들기
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>링크를 다시 만들까요?</AlertDialogTitle>
                      <AlertDialogDescription>
                        새 링크를 만들면 이전 링크는 사용할 수 없어요.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction onClick={() => regenerate.mutate()}>
                        다시 만들기
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
              <p className="text-lead font-bold text-ink">{maskInviteUrl(invite.invite_url)}</p>
              <p className="flex gap-3 text-body text-ink-muted">
                <span>연결 상태</span>
                <span aria-hidden="true">·</span>
                <span>
                  {invite.parent_linked ? "보호자가 연결됐어요" : "아직 연결된 보호자가 없어요"}
                </span>
              </p>
              <p className="text-label text-ink-muted">
                새 링크를 만들면 이전 링크는 사용할 수 없어요.
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
