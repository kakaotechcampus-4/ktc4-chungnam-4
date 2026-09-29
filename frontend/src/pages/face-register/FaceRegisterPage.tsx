// Figma: 1:3451 (추출본 Untitled 1:1872)
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import { registerFaceEmbedding } from "@/api/face";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { objectUrlFor, releaseObjectUrl } from "@/features/classify/object-url";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { useRouteChild } from "@/features/classify/use-route-child";
import { extractMockEmbedding } from "@/features/ondevice/mock-embedding";

const MAX_PHOTOS = 3;

// 등록 사진은 브라우저에서 임베딩만 뽑고 버립니다. 원본은 서버·S3로 보내지 않습니다(H-3).
// 미리보기도 이 탭의 메모리(object URL)에만 있고, 등록이 끝나거나 화면을 떠나면 지웁니다.
// TODO(김동건): 동의 상태·등록 여부 조회 API가 없어 부제와 "등록됨" 줄은 예시 값입니다. 동의가 없으면 등록을 막아야 합니다.
export function FaceRegisterPage() {
  const route = useRouteChild();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const fileInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const previews = photos.map((photo) => objectUrlFor(photo));
  // 고른 사진을 바꾸거나 비울 때 이전 미리보기 주소를 지웁니다.
  function replacePhotos(next: File[]) {
    photos.forEach((photo) => releaseObjectUrl(photo));
    setPhotos(next);
  }

  const registration = useMutation({
    mutationFn: async ({ childId, files }: { childId: string; files: File[] }) => {
      const extracted = await extractMockEmbedding(files);
      return registerFaceEmbedding(childId, extracted);
    },
    // 벡터를 보냈으면 사진은 더 들고 있지 않습니다.
    onSuccess: () => replacePhotos([]),
  });

  if (route.status !== "ready") return <RouteChildFallback state={route} />;
  const { child } = route;

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
            <Button
              className="w-70 border-transparent"
              disabled={photos.length === 0 || registration.isPending}
              onClick={() => registration.mutate({ childId: child.child_id, files: photos })}
            >
              {registration.isPending ? "등록하는 중…" : "얼굴 정보 등록 · 갱신"}
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
            {Array.from({ length: MAX_PHOTOS }, (_, i) => (
              <li key={i}>
                {previews[i] ? (
                  <img
                    src={previews[i]}
                    alt={`고른 사진 ${i + 1}`}
                    className="h-37.5 w-54 rounded-xl bg-neutral-soft object-contain p-1"
                  />
                ) : (
                  <PhotoPlaceholder
                    label={`등록 사진 ${i + 1}`}
                    className="h-37.5 w-54 rounded-xl"
                  />
                )}
              </li>
            ))}
          </ul>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/heic"
            multiple
            hidden
            aria-label="등록할 사진"
            onChange={(event) => {
              replacePhotos(Array.from(event.target.files ?? []).slice(0, MAX_PHOTOS));
              registration.reset();
              event.target.value = "";
            }}
          />
          <div className="flex items-center gap-4 text-body font-bold text-ink">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-xs outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              사진 바꾸기
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              disabled={photos.length === 0}
              onClick={() => replacePhotos([])}
              className="rounded-xs outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
            >
              선택 사진 제거
            </button>
          </div>
          <p className="text-label text-ink-muted">등록됨 · 2026. 9. 15. · 김하늘 선생님</p>
          <div aria-live="polite" className="text-body">
            {registration.isSuccess ? (
              <p className="text-brand-ink">얼굴 정보를 등록했어요.</p>
            ) : null}
            {registration.error ? (
              <p className="text-destructive">{registration.error.message}</p>
            ) : null}
            {notice && !registration.isSuccess ? <p className="text-brand-ink">{notice}</p> : null}
          </div>
        </div>
      </FocusCard>
    </div>
  );
}
