// Figma: 1:3451 (추출본 Untitled 1:1872)
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import { registerFaceEmbedding } from "@/api/face";
import { mediaKeys } from "@/api/media";
import { organizationKeys } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { objectUrlFor, useReleaseObjectUrls } from "@/features/classify/object-url";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { useRouteChild } from "@/features/classify/use-route-child";
import { faceStatus } from "@/features/organization/labels";

import { extractEmbedding } from "@/workers/face/client";

/** 임시 결정(김동건): 1~3장이면 등록할 수 있습니다. 많을수록 정확하지만 3장을 강제하지 않습니다. */
const MAX_PHOTOS = 3;

type Slots = (File | null)[];

const EMPTY_SLOTS: Slots = Array.from({ length: MAX_PHOTOS }, () => null);

// 등록 사진은 브라우저에서 임베딩만 뽑고 버립니다. 원본은 서버·S3로 보내지 않습니다(H-3).
// 미리보기도 이 탭의 메모리(object URL)에만 있고, 등록이 끝나거나 화면을 떠나면 지웁니다.
// TODO(송유진): 동의 상태·등록 여부는 원아 상세(GET /children/{child_id}, docs/api/screens.md)가 생기면
// 부제와 "등록됨" 줄로 보여 줍니다. 그 전에는 서버 값이 없어 아무것도 보이지 않습니다. 고정 예시 값을 두면
// 등록하지 않은 원아도 "등록됨"으로 보입니다(10/30 배포 점검).
// ③ 동의가 없으면 폼 대신 잠금 안내를 보여 줍니다. 원아 등록 화면의 버튼은 잠겨 있어도 주소로는 들어올 수
// 있고, 폼을 그대로 두면 사진을 고른 뒤에야 서버가 403(FACE_CONSENT_REQUIRED)으로 막습니다(H-3).
export function FaceRegisterPage() {
  const route = useRouteChild();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const fileInput = useRef<HTMLInputElement>(null);
  // 파일 선택 창을 연 칸. null이면 빈 칸부터 차례로 채웁니다.
  const targetSlot = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  // 칸에서 빼거나 바꾼 사진, 등록한 사진, 화면을 떠날 때의 사진은 미리보기 주소를 지웁니다(#83 리뷰 7).
  useReleaseObjectUrls(slots);
  const previews = slots.map((file) => (file ? objectUrlFor(file) : null));
  const photos = slots.filter((file): file is File => file !== null);

  const registration = useMutation({
    // classId는 캐시를 비울 때 씁니다 — 응답을 기다리는 사이 화면이 바뀌어도 요청한 반을 비웁니다.
    mutationFn: async ({ childId, files }: { childId: string; classId: string; files: File[] }) => {
      const extracted = await extractEmbedding(files);
      if (extracted.extract_state !== "extracted") {
        throw new Error(
          extracted.extract_state === "multiple_faces"
            ? "한 명만 나온 사진을 골라 주세요."
            : extracted.extract_state === "no_face"
              ? "얼굴을 찾지 못했어요. 정면 사진을 골라 주세요."
              : "얼굴 분석에 실패했어요. 다시 시도해 주세요.",
        );
      }
      return registerFaceEmbedding(childId, extracted.embedding);
    },
    onSuccess: async (_result, variables) => {
      // 벡터를 보냈으면 사진은 더 들고 있지 않습니다.
      setSlots(EMPTY_SLOTS);
      // 삭제와 같은 이유로 캐시를 비웁니다(FaceDeletePage 주석). 비우지 않으면 방금 등록한
      // 아이가 분류에서 빠지고, 원아 등록 화면도 "미등록"으로 남습니다.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: mediaKeys.faceEmbeddings(variables.classId) }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.children(variables.classId) }),
      ]);
    },
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

  if (faceStatus(child) === "locked") {
    return (
      <div className="pb-10">
        <PageHeader eyebrow="우리 반 관리 / 얼굴 정보" title={`${child.name} · 얼굴 정보 관리`} />
        <FocusCard
          centered
          footer={
            <>
              <Button asChild variant="outline">
                <Link to="/t/children">우리 반 관리로 돌아가기</Link>
              </Button>
              {/* 동의가 없어도 이미 있는 정보를 지울 수는 있어야 합니다. */}
              {child.is_face_registered ? (
                <Button asChild variant="outline">
                  <Link to="delete">등록 정보 삭제</Link>
                </Button>
              ) : null}
            </>
          }
        >
          <LockKeyhole aria-hidden="true" className="size-10 text-line" strokeWidth={1.5} />
          <h2 className="text-lead font-bold text-ink">얼굴 정보를 등록할 수 없어요</h2>
          <p className="text-body text-ink-muted">
            보호자가 얼굴 특징정보 처리에 동의하면 등록할 수 있어요.
          </p>
          {notice ? <p className="text-body text-brand-ink">{notice}</p> : null}
        </FocusCard>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <PageHeader eyebrow="우리 반 관리 / 얼굴 정보" title={`${child.name} · 얼굴 정보 관리`} />

      <FocusCard
        className="min-h-140"
        footer={
          <>
            <Button
              className="w-70 border-transparent"
              disabled={photos.length === 0 || registration.isPending}
              onClick={() =>
                registration.mutate({
                  childId: child.child_id,
                  classId: child.class_id,
                  files: photos,
                })
              }
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
