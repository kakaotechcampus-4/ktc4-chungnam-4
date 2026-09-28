// Figma: 1:528
import { useQuery } from "@tanstack/react-query";

import { meQueryOptions } from "@/api/auth";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/features/auth/use-logout";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { cn } from "@/lib/utils";

interface InfoRowProps {
  label: string;
  /** 받기 전이면 null입니다. 받으면 한 번에 나타납니다. */
  value: string | null | undefined;
}

// 교사의 계정 정보와 로그아웃입니다. 값은 Figma 실측입니다(카드 여백 28 · 반경 18 · 줄 간격 18, 카드 사이 24, 이름 칸 160).
// Figma와 다르게 둔 곳:
// - 제목 줄은 다른 교사 화면과 같은 PageHeader를 씁니다(Figma는 이 화면만 제목 블록이 낮습니다).
// - "수정" 버튼과 알림 설정 카드는 뺐습니다. PATCH /me는 API 문서에 경로만 있고, 알림 설정은 FR·API가 없습니다.
// - 카드 제목 18은 토큰에 없어서 16(text-lead)으로 맞췄습니다.
export function SettingsPage() {
  const { data: me } = useQuery(meQueryOptions());
  const { currentClass, isPending: classesPending, isError: classesError } = useCurrentClass();
  const { data: children, isPending: childrenPending } = useQuery({
    ...classChildrenQueryOptions(currentClass?.class_id ?? ""),
    enabled: currentClass !== null,
  });
  const logout = useLogout();

  // 값이 받는 순서대로 하나씩 채워지지 않게, 원아 수까지 받은 뒤 세 줄을 한 번에 보여 줍니다.
  // 반이 없으면 원아 명단은 요청하지 않아서 기다리지 않습니다(꺼진 쿼리는 계속 pending입니다).
  const ready = me !== undefined && !classesPending && (currentClass === null || !childrenPending);

  const classLine = currentClass
    ? [currentClass.name, currentClass.age_group, children ? `원아 ${children.length}명` : null]
        .filter(Boolean)
        .join(" · ")
    : classesPending
      ? null
      : classesError
        ? "반 정보를 불러오지 못했어요"
        : "담당 반이 없어요";

  return (
    <>
      <PageHeader
        eyebrow="계정"
        title={me && me.account_type === "teacher" ? `${me.name} 선생님` : "계정"}
        subtitle="계정 정보를 관리해요."
      />
      <div className="flex flex-col gap-6">
        <section
          aria-labelledby="account-info"
          className="flex flex-col gap-4.5 rounded-3xl border border-line bg-paper p-7"
        >
          <h2 id="account-info" className="text-lead font-bold text-ink">
            계정 정보
          </h2>
          <dl className="flex flex-col gap-4.5 text-body">
            <InfoRow label="이메일" value={ready ? me.email : null} />
            <InfoRow label="소속 어린이집" value={ready ? currentClass?.center_name : null} />
            <InfoRow label="담당 반" value={ready ? classLine : null} />
          </dl>
        </section>
        <section className="flex items-center justify-between rounded-3xl border border-line bg-paper p-7">
          <div className="flex flex-col gap-1">
            <h2 className="text-lead font-bold text-ink">로그아웃</h2>
            <p className="text-label text-ink-muted">이 브라우저에서 아이담 계정을 나갑니다.</p>
          </div>
          <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
            로그아웃
          </Button>
        </section>
      </div>
    </>
  );
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex gap-6">
      <dt className="w-40 shrink-0 text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "text-ink",
          value !== null && "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300",
        )}
      >
        {value ?? ""}
      </dd>
    </div>
  );
}
