// Figma: 1:610 · 1:690 (FR-28 초대·가입·동의 연결)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  acceptParentInvite,
  createSession,
  deleteCurrentSession,
  invitePreviewQueryOptions,
  meQueryOptions,
} from "@/api/auth";
import { ApiError } from "@/lib/api-client";
import { FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";

export function ParentInvitePage() {
  const { inviteToken = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invite = useQuery(invitePreviewQueryOptions(inviteToken));
  const me = useQuery({ ...meQueryOptions(), retry: false, throwOnError: false });
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [guardian, setGuardian] = useState(false);
  const [personal, setPersonal] = useState(false);
  const [media, setMedia] = useState(false);
  const [face, setFace] = useState(false);
  const isParent = me.data?.account_type === "parent";
  const login = useMutation({
    mutationFn: () => createSession({ email, password }),
    throwOnError: false,
    onSuccess: async () => {
      setPassword("");
      queryClient.clear();
      await queryClient.fetchQuery(meQueryOptions());
    },
  });
  const logout = useMutation({
    mutationFn: deleteCurrentSession,
    throwOnError: false,
    onSuccess: () => queryClient.clear(),
  });
  const accept = useMutation({
    mutationFn: () =>
      acceptParentInvite(inviteToken, {
        ...(isParent ? {} : { email, password, name }),
        is_legal_guardian: guardian,
        consents: { personal_info: personal, activity_media: media, face_feature: face },
      }),
    onSuccess: () => {
      setPassword("");
      queryClient.clear();
      navigate("/p", { replace: true });
    },
  });
  if (invite.error)
    return (
      <div role="alert">
        <h1 className="text-h2">초대를 열 수 없어요</h1>
        <p>{invite.error.message}</p>
        <p>선생님께 새 링크를 요청해 주세요.</p>
      </div>
    );
  if (me.error && (!(me.error instanceof ApiError) || me.error.status !== 401))
    return (
      <div role="alert">
        <p>로그인 상태를 확인하지 못했어요. {me.error.message}</p>
        <Button onClick={() => void me.refetch()}>다시 확인</Button>
      </div>
    );
  if (!invite.data || me.isPending) return <p role="status">초대를 확인하고 있어요.</p>;
  return (
    <section className="flex w-full max-w-form-md flex-col gap-5 rounded-xl bg-paper p-8">
      <h1 className="text-h2 font-bold">{invite.data.child_name}의 보호자 초대</h1>
      <p>
        {invite.data.center_name} · {invite.data.class_name}
      </p>
      {me.data?.account_type === "teacher" ? (
        <>
          <p>현재 교사 계정이에요. 로그아웃한 뒤 학부모 계정으로 진행해 주세요.</p>
          <Button onClick={() => logout.mutate()} disabled={logout.isPending}>
            로그아웃
          </Button>
          {logout.error ? <p role="alert">{logout.error.message}</p> : null}
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isParent && mode === "login") login.mutate();
            else accept.mutate();
          }}
        >
          {isParent ? (
            <>
              <p>{me.data?.name} 보호자님의 계정에 이 자녀를 연결해요.</p>
              <Button type="button" variant="outline" onClick={() => logout.mutate()}>
                다른 계정으로 진행
              </Button>
            </>
          ) : (
            <>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={mode === "signup" ? "default" : "outline"}
                  onClick={() => setMode("signup")}
                >
                  새 학부모 가입
                </Button>
                <Button
                  type="button"
                  variant={mode === "login" ? "default" : "outline"}
                  onClick={() => setMode("login")}
                >
                  기존 계정 로그인
                </Button>
              </div>
              {mode === "signup" ? (
                <FormField
                  label="보호자 이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                />
              ) : null}
              <FormField
                label="이메일"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
              <FormField
                label="비밀번호"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </>
          )}
          {isParent || mode === "signup" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 font-bold">자녀 연결 및 동의</legend>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={guardian}
                  onChange={(e) => setGuardian(e.target.checked)}
                  required
                />
                이 원아의 법정대리인입니다. (필수)
              </label>
              <p className="text-caption text-ink-muted">
                자녀와 반 정보는 보육 기록 작성과 보호자 열람에 사용됩니다. 활동 사진·영상·음성은
                기록 생성과 교사 검수에 사용되며, 음성은 외부 STT로 처리됩니다. 얼굴 특징 동의 시
                브라우저에서 얼굴을 분류하고 동의한 사진을 외부 AI로 분석합니다. 등록용 얼굴 원본은
                서버에 전송하지 않습니다.
              </p>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={personal}
                  onChange={(e) => setPersonal(e.target.checked)}
                  required
                />
                개인정보 수집·이용에 동의합니다. (필수)
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={media}
                  onChange={(e) => setMedia(e.target.checked)}
                  required
                />
                활동 사진·영상·음성 처리에 동의합니다. (필수)
              </label>
              <label className="flex gap-2">
                <input type="checkbox" checked={face} onChange={(e) => setFace(e.target.checked)} />
                얼굴 특징정보 처리에 동의합니다. (선택)
              </label>
              <p className="text-caption text-ink-muted">
                선택 동의 없이도 가입하고 선생님이 게시한 알림장을 볼 수 있어요. 얼굴 등록·자동 사진
                분석은 제외됩니다.
              </p>
            </fieldset>
          ) : null}
          <Button
            type="submit"
            disabled={
              accept.isPending ||
              login.isPending ||
              ((isParent || mode === "signup") && (!guardian || !personal || !media))
            }
          >
            {accept.isPending
              ? "연결하고 있어요"
              : !isParent && mode === "login"
                ? "로그인"
                : "동의하고 자녀 연결"}
          </Button>
          {accept.error || login.error || logout.error ? (
            <p role="alert">{(accept.error ?? login.error ?? logout.error)?.message}</p>
          ) : null}
        </form>
      )}
    </section>
  );
}
