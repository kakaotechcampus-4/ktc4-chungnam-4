// Figma: 1:3451 (추출본 Untitled 1:1872)
import { Link, useParams } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { findSampleChild } from "@/features/classify/sample-data";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";

// 등록 사진은 브라우저에서 임베딩만 뽑고 버립니다. 원본은 서버·S3로 보내지 않습니다(H-3).
// TODO(김동건): 등록 흐름(workers/의 얼굴 검출, 동의 미완료 시 등록 막기)은 온디바이스 작업에서 붙입니다.
export function FaceRegisterPage() {
  const { childId } = useParams();
  const child = findSampleChild(childId);

  if (!child) return <NotFoundPage />;

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="우리 반 관리 / 얼굴 정보"
        title={`${child.name} · 얼굴 정보 관리`}
        subtitle="동의 3 / 3 확인 완료 · 이 기기 등록 상태"
      />

      <FocusCard
        className="min-h-140"
        footer={
          <>
            <Button className="w-70 border-transparent" disabled>
              얼굴 정보 등록 · 갱신
            </Button>
            <Button asChild className="w-52.5 border-transparent">
              <Link to="delete">등록 정보 삭제</Link>
            </Button>
          </>
        }
      >
        <div className="flex flex-1 flex-col gap-5">
          <h2 className="text-h3 font-bold text-ink">분류용 얼굴 정보 등록</h2>
          <p className="text-body text-ink-muted">정면과 서로 다른 각도의 사진을 골라 주세요.</p>
          <ul aria-label="등록 사진" className="flex gap-4">
            {[1, 2, 3].map((n) => (
              <li key={n}>
                <PhotoPlaceholder label={`등록 사진 ${n}`} className="h-37.5 w-54 rounded-xl" />
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-4 text-body font-bold text-ink">
            <button type="button" disabled className="disabled:opacity-40">
              사진 바꾸기
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" disabled className="disabled:opacity-40">
              선택 사진 제거
            </button>
          </div>
          <p className="text-label text-ink-muted">등록됨 · 2026. 9. 15. · 김하늘 선생님</p>
        </div>
      </FocusCard>
    </div>
  );
}
