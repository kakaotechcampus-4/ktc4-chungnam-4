import { ArrowRight, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";

interface InviteIntroProps {
  /** 문장에 넣는 호칭. 예: 도윤이 */
  call: string;
  centerName: string;
  className: string;
  onStart: () => void;
  onLogin: () => void;
}

// 초대 링크의 첫 화면(Figma 1차 결과본 W1 106:4284). 오른쪽 카드는 앞으로 받을 알림장의 모양을 보여 주는 장식입니다.
// 실제 알림장이 아니라서 아이 정보는 호칭만 쓰고, 아직 계정이 없는 사람에게 사진이나 글을 보여 주지 않습니다(H-1).
export function InviteIntro({ call, centerName, className, onStart, onLogin }: InviteIntroProps) {
  return (
    <div className="grid w-full max-w-parent items-center gap-12 lg:grid-cols-2">
      <div className="flex flex-col items-start gap-5 motion-safe:animate-rise">
        <span className="rounded-full bg-leaf-soft px-3 py-1 text-caption font-bold text-brand-ink">
          {centerName} · {className}
        </span>
        <h1 className="text-h2 font-bold tracking-tight text-ink sm:text-h1">
          {call}의 하루를
          <br />
          함께 받아 보세요
        </h1>
        <p className="text-lead text-ink-muted">
          선생님이 승인한 알림장과 사진을 이곳에서 볼 수 있어요.
          <br />
          계정을 만들면 지난 알림장도 함께 볼 수 있어요.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="solid" className="group active:scale-98" onClick={onStart}>
            시작하기
            <ArrowRight
              aria-hidden="true"
              className="transition-transform duration-300 ease-soft group-hover:translate-x-1"
            />
          </Button>
          <Button variant="outline" className="active:scale-98" onClick={onLogin}>
            이미 계정이 있어요
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-label text-ink-muted">
          <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" />
          초대 링크로 들어오셨어요. {call}의 보호자만 볼 수 있어요.
        </p>
      </div>
      <div
        aria-hidden="true"
        className="rounded-3xl border border-line/70 bg-paper p-4 shadow-card-hover transition duration-500 ease-soft hover:-translate-y-1 hover:-rotate-1 motion-safe:animate-rise"
        style={{ animationDelay: "120ms" }}
      >
        <div className="grid aspect-16/10 grid-cols-3 grid-rows-2 gap-1.5 overflow-hidden rounded-2xl">
          <div className="col-span-2 row-span-2 bg-leaf-soft" />
          <div className="bg-tint-2" />
          <div className="bg-coral-soft" />
        </div>
        <div className="flex flex-col gap-3 px-1.5 pt-4 pb-1.5">
          <p className="text-nav font-bold text-ink">오늘의 알림장</p>
          <div className="h-2.5 w-full rounded-full bg-neutral-soft" />
          <div className="h-2.5 w-4/5 rounded-full bg-neutral-soft" />
          <p className="mt-1 flex items-center gap-2 rounded-xl bg-tint-2 p-3 text-label text-ink">
            <LockKeyhole className="size-4 shrink-0 text-brand-ink" />
            계정을 만들면 전부 볼 수 있어요
          </p>
        </div>
      </div>
    </div>
  );
}
