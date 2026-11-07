// Figma: 1차 결과본 W1 106:4284 · W2 106:4328 (FR-28 초대·가입·동의 연결). 처음 안(1:610 · 1:690)의 동의 항목은 그대로 둡니다.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, CircleCheck, FileText, LockKeyhole, ShieldCheck } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  acceptParentInvite,
  createSession,
  deleteCurrentSession,
  invitePreviewQueryOptions,
  meQueryOptions,
} from "@/api/auth";
import { FocusCard } from "@/components/common/FocusCard";
import { FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { nickname } from "@/lib/child-name";
import { cn } from "@/lib/utils";

import { InviteIntro } from "./components/InviteIntro";

interface ConsentRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  required?: boolean;
  children: ReactNode;
}

function ConsentRow({ checked, onChange, required = false, children }: ConsentRowProps) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-1.5 text-body text-ink transition-colors duration-200 hover:bg-tint-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required={required}
        className="mt-1 size-4 shrink-0 accent-brand-ink"
      />
      <span className="flex-1">{children}</span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-px text-caption font-bold",
          required ? "bg-brand-ink text-paper" : "bg-neutral-soft text-ink-muted",
        )}
      >
        {required ? "필수" : "선택"}
      </span>
    </label>
  );
}

export function ParentInvitePage() {
  const { inviteToken = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invite = useQuery(invitePreviewQueryOptions(inviteToken));
  const me = useQuery({ ...meQueryOptions(), retry: false, throwOnError: false });
  const [step, setStep] = useState<"intro" | "form">("intro");
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
      <div role="alert" className="w-full max-w-reading">
        <FocusCard centered className="rounded-3xl border border-line/70 shadow-card">
          <LockKeyhole aria-hidden="true" className="size-10 text-line" strokeWidth={1.5} />
          <h1 className="text-h3 font-bold text-ink">초대를 열 수 없어요</h1>
          <p className="text-body text-ink-muted">{invite.error.message}</p>
          <p className="text-body text-ink-muted">선생님께 새 링크를 요청해 주세요.</p>
        </FocusCard>
      </div>
    );
  if (me.error && (!(me.error instanceof ApiError) || me.error.status !== 401))
    return (
      <div role="alert" className="w-full max-w-reading">
        <FocusCard centered className="rounded-3xl border border-line/70 shadow-card">
          <p className="text-body text-ink">로그인 상태를 확인하지 못했어요. {me.error.message}</p>
          <Button variant="outline" onClick={() => void me.refetch()}>
            다시 확인
          </Button>
        </FocusCard>
      </div>
    );
  if (!invite.data || me.isPending) return <p role="status">초대를 확인하고 있어요.</p>;

  const call = nickname(invite.data.child_name);
  // 로그인 전에는 초대 소개(W1)부터 보여 줍니다. 이미 로그인했으면 바로 연결 화면입니다.
  if (!me.data && step === "intro") {
    return (
      <InviteIntro
        call={call}
        centerName={invite.data.center_name}
        className={invite.data.class_name}
        onStart={() => {
          setMode("signup");
          setStep("form");
        }}
        onLogin={() => {
          setMode("login");
          setStep("form");
        }}
      />
    );
  }

  const heading = isParent ? "자녀 연결하기" : mode === "login" ? "로그인" : "계정 만들기";
  const subheading = isParent
    ? `${call}의 알림장을 이 계정에서 볼 수 있게 연결해요.`
    : `${call}의 알림장을 보려면 계정이 필요해요.`;

  return (
    <div className="grid w-full max-w-4xl items-start gap-10 py-10 lg:grid-cols-2">
      <div className="flex flex-col gap-5 motion-safe:animate-rise lg:sticky lg:top-10">
        {!me.data ? (
          <button
            type="button"
            onClick={() => setStep("intro")}
            className="group flex items-center gap-1 self-start rounded-xs text-body text-ink-muted outline-none transition-colors duration-200 hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft
              aria-hidden="true"
              className="size-4 transition-transform duration-300 ease-soft group-hover:-translate-x-1"
            />
            처음으로
          </button>
        ) : null}
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 font-bold tracking-tight text-ink">{heading}</h1>
          <p className="text-body text-ink-muted">{subheading}</p>
        </div>
        <div className="flex items-start gap-3 rounded-2xl bg-leaf-soft p-4">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-ink" />
          <div className="flex flex-col">
            <p className="text-body font-bold text-brand-ink">초대 링크를 확인했어요</p>
            <p className="text-label text-ink-muted">
              {invite.data.child_name} · {invite.data.class_name} · {invite.data.center_name}
            </p>
          </div>
        </div>
        <ul className="flex flex-col gap-2 text-label text-ink-muted">
          <li className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
            선생님이 승인한 알림장만 보여요
          </li>
          <li className="flex items-center gap-2">
            <FileText aria-hidden="true" className="size-4 shrink-0" />
            열람하면 기록이 남아요
          </li>
          <li className="flex items-center gap-2">
            <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
            {call}의 보호자만 볼 수 있어요
          </li>
        </ul>
      </div>
      <section
        className="flex flex-col gap-5 rounded-3xl border border-line/70 bg-paper p-6 shadow-card motion-safe:animate-rise sm:p-8"
        style={{ animationDelay: "80ms" }}
      >
        {me.data?.account_type === "teacher" ? (
          <>
            <p className="text-body text-ink">
              현재 교사 계정이에요. 로그아웃한 뒤 학부모 계정으로 진행해 주세요.
            </p>
            <Button onClick={() => logout.mutate()} disabled={logout.isPending}>
              로그아웃
            </Button>
            {logout.error ? (
              <p role="alert" className="text-label text-destructive">
                {logout.error.message}
              </p>
            ) : null}
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
                <p className="text-body text-ink">
                  {me.data?.name} 보호자님의 계정에 이 자녀를 연결해요.
                </p>
                <Button type="button" variant="outline" onClick={() => logout.mutate()}>
                  다른 계정으로 진행
                </Button>
              </>
            ) : (
              <>
                <div className="relative grid grid-cols-2 rounded-full bg-tint-2 p-1">
                  <span aria-hidden="true" className="absolute inset-1">
                    <span
                      className={cn(
                        "block h-full w-1/2 rounded-full bg-paper shadow-xs motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-soft",
                        mode === "login" && "translate-x-full",
                      )}
                    />
                  </span>
                  {(
                    [
                      ["signup", "새 학부모 가입"],
                      ["login", "기존 계정 로그인"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={mode === value}
                      onClick={() => setMode(value)}
                      className={cn(
                        "relative rounded-full py-2 text-label font-bold outline-none transition-colors duration-300 focus-visible:ring-3 focus-visible:ring-ring/50",
                        mode === value ? "text-brand-ink" : "text-ink-muted hover:text-brand-ink",
                      )}
                    >
                      {label}
                    </button>
                  ))}
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
              <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
                <legend className="mb-2 text-body font-bold text-ink">자녀 연결 및 동의</legend>
                <ConsentRow checked={guardian} onChange={setGuardian} required>
                  이 원아의 법정대리인입니다.
                </ConsentRow>
                <p className="px-1.5 text-caption text-ink-muted">
                  자녀와 반 정보는 보육 기록 작성과 보호자 열람에 사용됩니다. 활동 사진·영상·음성은
                  기록 생성과 교사 검수에 사용되며, 음성은 외부 STT로 처리됩니다. 얼굴 특징 동의 시
                  브라우저에서 얼굴을 분류하고 동의한 사진을 외부 AI로 분석합니다. 등록용 얼굴
                  원본은 서버에 전송하지 않습니다.
                </p>
                <ConsentRow checked={personal} onChange={setPersonal} required>
                  개인정보 수집·이용에 동의합니다.
                </ConsentRow>
                <ConsentRow checked={media} onChange={setMedia} required>
                  활동 사진·영상·음성 처리에 동의합니다.
                </ConsentRow>
                <ConsentRow checked={face} onChange={setFace}>
                  얼굴 특징정보 처리에 동의합니다.
                </ConsentRow>
                <p className="px-1.5 text-caption text-ink-muted">
                  선택 동의 없이도 가입하고 선생님이 게시한 알림장을 볼 수 있어요. 얼굴 등록·자동
                  사진 분석은 제외됩니다.
                </p>
              </fieldset>
            ) : null}
            <Button
              type="submit"
              variant="solid"
              size="lg"
              className="w-full active:scale-99"
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
              <p role="alert" className="text-label text-destructive">
                {(accept.error ?? login.error ?? logout.error)?.message}
              </p>
            ) : null}
          </form>
        )}
      </section>
    </div>
  );
}
