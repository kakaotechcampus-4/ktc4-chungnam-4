// Figma: 1:3451 (추출본 Untitled 1:1872)
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, LockKeyhole } from "lucide-react";
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

/**
 * 임시 결정(김동건): 1~3장이면 등록할 수 있습니다. 3장을 강제하지 않습니다.
 *
 * **장수보다 각도가 중요합니다.** 조원 실사진으로 재 보니 정면 1장만 쓰면 얼굴 63개 중
 * 36개를 맞혔고, 정면·왼쪽45·오른쪽45 세 각도를 쓰면 46개를 맞혔습니다. 반대로 가진
 * 사진을 전부 넣으면 맞힘이 47→46으로 줄고 **등록하지 않은 사람이 붙는 점수가
 * 0.72→0.76으로 올랐습니다** — 내 점수만 오르는 게 아니라 남의 점수도 같이 오릅니다.
 * 그래서 "많을수록 정확하다"는 틀린 말이라 안내 문구에서 뺐습니다(#293).
 *
 * 3장 상한은 그대로 둡니다. 각도마다 2장씩(최대 6장)이 더 나았지만 실제로 쓰인 건 3~4장
 * 뿐이라, **6장 구성으로 직접 재 본 뒤에 정하기로 했습니다**(#293 엄태은 님 의견).
 *
 * 등록 4명(성인)으로 잰 숫자입니다. 실제 원아나 더 큰 반에서도 같은지는 아직 모릅니다
 * (#293 정은 님 의견).
 */
const MAX_PHOTOS = 3;

type Slots = (File | null)[];

const EMPTY_SLOTS: Slots = Array.from({ length: MAX_PHOTOS }, () => null);

// 등록 사진은 브라우저에서 임베딩만 뽑고 버립니다. 원본은 서버·S3로 보내지 않습니다(H-3).
// 미리보기도 이 탭의 메모리(object URL)에만 있고, 등록이 끝나거나 화면을 떠나면 지웁니다.
// TODO(송유진): 부제와 "등록됨" 줄로 동의 상태·등록 여부를 보여 주는 것이 남았습니다. 반 명단에 이미 오는
// face_feature_agreed·is_face_registered로 그리면 됩니다. 고정 예시 값은 두지 않습니다. 등록하지 않은
// 원아도 "등록됨"으로 보였습니다(10/30 배포 점검).
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
          className="motion-safe:animate-enter"
          footer={
            <>
              <Button asChild variant="outline">
                <Link viewTransition to="/t/children">
                  우리 반 관리로 돌아가기
                </Link>
              </Button>
              {/* 동의가 없어도 이미 있는 정보를 지울 수는 있어야 합니다. */}
              {child.is_face_registered ? (
                <Button asChild variant="outline">
                  <Link viewTransition to="delete">
                    등록 정보 삭제
                  </Link>
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
        className="min-h-140 motion-safe:animate-enter"
        footer={
          <>
            {/* 얼굴 분석 모델을 처음 받는 동안 몇 초 걸릴 수 있어, 버튼 안에서 돌며 기다리는 중임을 알립니다. */}
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
              {registration.isPending ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 shrink-0 motion-safe:animate-spin"
                  />
                  등록하는 중…
                </>
              ) : (
                "얼굴 정보 등록 · 갱신"
              )}
            </Button>
            <Button asChild className="w-52.5 border-transparent">
              <Link viewTransition to="delete">
                등록 정보 삭제
              </Link>
            </Button>
          </>
        }
      >
        <div className="flex flex-1 flex-col gap-5">
          <h2 className="text-h3 font-bold text-ink">분류용 얼굴 정보 등록</h2>
          <p className="text-body text-ink-muted">
            정면 1장, 왼쪽 45도 1장, 오른쪽 45도 1장을 골라 주세요. 세 각도를 모두 올리면 분류가
            훨씬 잘돼요.
          </p>
          <ul aria-label="등록 사진" className="flex gap-4">
            {slots.map((file, index) => {
              const label = `등록 사진 ${index + 1}`;
              const preview = previews[index];
              return (
                <li key={index} className="flex flex-col gap-2">
                  {/* 빈 칸에 사진이 들어오면 떠오르며 나타나, 여러 장을 한 번에 골라도 어느 칸이 찼는지 보입니다. */}
                  {file && preview ? (
                    <img
                      src={preview}
                      alt={`고른 사진 ${index + 1}`}
                      className="h-37.5 w-54 rounded-xl bg-neutral-soft object-contain p-1 motion-safe:animate-enter"
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
            className="w-fit rounded-xs text-body font-bold text-ink outline-none transition-colors hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
          >
            빈 칸에 여러 장 고르기
          </button>
          {/* 등록은 원아당 한 개를 통째로 바꿉니다(PUT). 한 장만 골라 다시 등록하면 그 한 장으로 바뀝니다. */}
          <p className="text-label text-ink-muted">
            다시 등록하면 이전에 등록한 얼굴 정보가 이번에 고른 사진으로 모두 바뀌어요.
          </p>
          <div aria-live="polite" className="text-body">
            {/* 등록을 누른 뒤의 결과라 떠오르며 나타납니다. 오류 줄은 role="alert"가 아니어서 흔들지 않습니다. */}
            {registration.isSuccess ? (
              <p className="text-brand-ink motion-safe:animate-enter">얼굴 정보를 등록했어요.</p>
            ) : null}
            {registration.error ? (
              <p className="text-destructive motion-safe:animate-enter">
                {registration.error.message}
              </p>
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
      className="rounded-xs outline-none transition-colors hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}
