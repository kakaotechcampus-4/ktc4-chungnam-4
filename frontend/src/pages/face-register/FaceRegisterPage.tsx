// Figma: 1:3451 (추출본 Untitled 1:1872)
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import { registerFaceEmbedding } from "@/api/face";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { objectUrlFor, useReleaseObjectUrls } from "@/features/classify/object-url";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { useRouteChild } from "@/features/classify/use-route-child";

import { extractMockEmbedding } from "./mock-embedding";

/** 임시 결정(김동건): 1~3장이면 등록할 수 있습니다. 많을수록 정확하지만 3장을 강제하지 않습니다. */
const MAX_PHOTOS = 3;

type Slots = (File | null)[];

const EMPTY_SLOTS: Slots = Array.from({ length: MAX_PHOTOS }, () => null);

// 등록 사진은 브라우저에서 임베딩만 뽑고 버립니다. 원본은 서버·S3로 보내지 않습니다(H-3).
// 미리보기도 이 탭의 메모리(object URL)에만 있고, 등록이 끝나거나 화면을 떠나면 지웁니다.
// TODO(김동건): 동의 상태·등록 여부 조회 API가 없어 부제와 "등록됨" 줄은 예시 값입니다. 동의가 없으면 등록을 막아야 합니다.
export function FaceRegisterPage() {
  const route = useRouteChild();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const fileInput = useRef<HTMLInputElement>(null);
  // 파일 선택 창을 연 칸. null이면 빈 칸부터 차례로 채웁니다.
  const targetSlot = useRef<number | null>(null);
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  // 칸에서 빼거나 바꾼 사진, 등록한 사진, 화면을 떠날 때의 사진은 미리보기 주소를 지웁니다(#83 리뷰 7).
  useReleaseObjectUrls(slots);
  const previews = slots.map((file) => (file ? objectUrlFor(file) : null));
  const photos = slots.filter((file): file is File => file !== null);

  const registration = useMutation({
    mutationFn: async ({ childId, files }: { childId: string; files: File[] }) => {
      const extracted = await extractMockEmbedding(files);
      return registerFaceEmbedding(childId, extracted);
    },
    // 벡터를 보냈으면 사진은 더 들고 있지 않습니다.
    onSuccess: () => setSlots(EMPTY_SLOTS),
  });

  function pick(slot: number | null) {
    targetSlot.current = slot;
    fileInput.current?.click();
  }

  function placeFiles(files: File[]) {
    setSlots((prev) => {
      const next = [...prev];
      const slot = targetSlot.current;
      if (slot !== null) {
        next[slot] = files[0] ?? next[slot] ?? null;
        return next;
      }
      for (const file of files) {
        const empty = next.indexOf(null);
        if (empty === -1) break;
        next[empty] = file;
      }
      return next;
    });
    registration.reset();
  }

  function removeSlot(slot: number) {
    setSlots((prev) => prev.map((file, index) => (index === slot ? null : file)));
    registration.reset();
  }

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
          <p className="text-body text-ink-muted">
            정면과 서로 다른 각도의 사진을 최대 {MAX_PHOTOS}장 골라 주세요. 많을수록 분류가
            정확해요.
          </p>
          <ul aria-label="등록 사진" className="flex gap-4">
            {slots.map((file, index) => {
              const label = `등록 사진 ${index + 1}`;
              const preview = previews[index];
              return (
                <li key={index} className="flex flex-col gap-2">
                  {file && preview ? (
                    <img
                      src={preview}
                      alt={`고른 사진 ${index + 1}`}
                      className="h-37.5 w-54 rounded-xl bg-neutral-soft object-contain p-1"
                    />
                  ) : (
                    <PhotoPlaceholder label={label} className="h-37.5 w-54 rounded-xl" />
                  )}
                  <div className="flex items-center gap-3 text-label font-bold text-ink">
                    <SlotButton onClick={() => pick(index)}>
                      {file ? "바꾸기" : "사진 고르기"}
                      <span className="sr-only"> ({label})</span>
                    </SlotButton>
                    {file ? (
                      <SlotButton onClick={() => removeSlot(index)}>
                        선택 사진 제거<span className="sr-only"> ({label})</span>
                      </SlotButton>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/heic"
            multiple
            hidden
            aria-label="등록할 사진"
            onChange={(event) => {
              placeFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => pick(null)}
            disabled={photos.length === MAX_PHOTOS}
            className="w-fit rounded-xs text-body font-bold text-ink outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
          >
            빈 칸에 여러 장 고르기
          </button>
          {/* 등록은 원아당 한 개를 통째로 바꿉니다(PUT). 한 장만 골라 다시 등록하면 그 한 장으로 바뀝니다. */}
          <p className="text-label text-ink-muted">
            다시 등록하면 이전에 등록한 얼굴 정보가 이번에 고른 사진으로 모두 바뀌어요.
          </p>
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

interface SlotButtonProps {
  onClick: () => void;
  children: ReactNode;
}

function SlotButton({ onClick, children }: SlotButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xs outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}
