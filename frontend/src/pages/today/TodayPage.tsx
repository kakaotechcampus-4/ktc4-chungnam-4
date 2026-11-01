// Figma: 1:1895 (오늘의 기록 · 빈 상태), 후보 A 1:1913
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router";

import { isTeacher, meQueryOptions } from "@/api/auth";
import { classDraftsQueryOptions, type ClassDraftView } from "@/api/documents";
import { organizationKeys } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import {
  ACCEPTED_EXTENSIONS,
  isImportDone,
  isImportStage,
  useUploadQueue,
  type LocalMedia,
  type MediaKind,
} from "@/features/upload-queue/upload-queue-store";
import { useImportTicker } from "@/features/upload-queue/use-import-ticker";
import { ApiError } from "@/lib/api-client";
import { formatDate, kstToday } from "@/lib/datetime";
import { cn } from "@/lib/utils";

import { TodayUploadFailed } from "./components/TodayUploadFailed";
import { TodayUploading } from "./components/TodayUploading";
import emptyMedia from "./empty-media.svg";

const TEXT_LINK_CLASS =
  "rounded-xs text-body font-bold whitespace-pre text-brand-ink outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

/** 교사가 검토할 수 있는 알림장 초안이 있는지. 초안 검토 화면은 알림장 기준이고, 생성 중은 아직 열 수 없습니다. */
function hasReviewableNote(item: ClassDraftView) {
  const status = item.parent_note?.status;
  return status === "review" || status === "approved";
}

/** 초안 생성이 끝나지 않은 원아인지 */
function isGenerating(item: ClassDraftView) {
  return item.parent_note?.status === "generating" || item.observation_log?.status === "generating";
}

/**
 * 교사가 확인해야 하는 원아인지. 초안 없이 미분류로 끝났거나, 초안이 회수·모르는 상태입니다.
 * 모르는 상태를 빈 카드로 떨어뜨리면 초안이 있는데도 자료를 다시 올리게 됩니다.
 * 초안 검토 화면은 두 상태를 잠가 보여 주므로 승인되지 않습니다(H-1).
 */
function needsCheck(item: ClassDraftView) {
  const status = item.parent_note?.status;
  return item.unclassified !== null || status === "revoked" || status === "unknown";
}

/** 오늘 기록 상태에 따라 카드에 무엇을 보일지 */
type TodayCard =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "empty" }
  | { kind: "review"; childId: string }
  | { kind: "generating" }
  | { kind: "unclassified"; childId: string };

function pickCard(items: readonly ClassDraftView[]): TodayCard {
  // 처리 중 화면처럼 검토할 초안이 있는 원아를 먼저 고릅니다. 레일에서 다른 원아로 옮길 수 있습니다.
  const reviewable = items.find(hasReviewableNote);
  if (reviewable) return { kind: "review", childId: reviewable.child_id };
  if (items.some(isGenerating)) return { kind: "generating" };
  // 확인이 필요한 원아만 남았으면, 초안 검토 화면에서 그 원아를 골라 직접 씁니다.
  const unclassified = items.find(needsCheck);
  if (unclassified) return { kind: "unclassified", childId: unclassified.child_id };
  return { kind: "empty" };
}

/** 종류별 불러오기 개수. 업로드 중 화면(1:2406)의 칩에 씁니다. */
function importCount(items: readonly LocalMedia[], kind: MediaKind) {
  const ofKind = items.filter((item) => item.kind === kind);
  return {
    done: ofKind.filter((item) => item.import_progress >= 100).length,
    total: ofKind.length,
  };
}

// FR-15. 오늘 기록 상태(초안 있음·생성 중·미분류·없음)에 따라 카드를 바꿉니다.
// 이 화면에 파일을 끌어다 놓으면 업로드 큐에 담고 업로드 중(1:2406)으로 바꿉니다.
// 불러오기가 끝났을 때 형식이 안 맞아 빠진 파일이 있으면 업로드 실패(1:2520)를 보여 줍니다.
export function TodayPage() {
  const navigate = useNavigate();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const items = useUploadQueue((state) => state.items);
  const rejected = useUploadQueue((state) => state.rejected);
  const addFiles = useUploadQueue((state) => state.addFiles);
  const removeRejected = useUploadQueue((state) => state.removeRejected);
  const resetQueue = useUploadQueue((state) => state.reset);
  const { data: me } = useQuery({ ...meQueryOptions(), throwOnError: false });
  useImportTicker();

  const queryClient = useQueryClient();
  const {
    currentClass,
    isPending: classPending,
    isError: classError,
    error: classErrorValue,
  } = useCurrentClass();
  const recordDate = kstToday();
  const today = formatDate(recordDate);
  const subtitle = currentClass ? `${today}  ·  ${currentClass.name}` : today;
  const classId = currentClass?.class_id ?? "";

  // 처리 중 화면을 떠난 뒤에도 초안 검토로 돌아올 수 있게 합니다(#109, docs/api/README.md 하루 흐름 2단계).
  // 자동으로 넘기지 않고 버튼으로 둡니다 — 초안이 있어도 자료를 더 올리러 들어올 수 있습니다.
  const draftsQuery = useQuery({
    ...classDraftsQueryOptions(classId, recordDate),
    enabled: classId !== "",
  });

  // 불러오는 동안 빈 상태를 먼저 보이지 않습니다. 실패를 빈 상태로 보이면 같은 자료를 다시 올리게 됩니다.
  const card: TodayCard = classPending
    ? { kind: "loading" }
    : classError
      ? { kind: "error", error: classErrorValue }
      : classId === ""
        ? { kind: "empty" }
        : draftsQuery.isPending
          ? { kind: "loading" }
          : draftsQuery.isError
            ? { kind: "error", error: draftsQuery.error }
            : pickCard(draftsQuery.data);

  function retry() {
    if (classError) {
      void queryClient.refetchQueries({ queryKey: organizationKeys.classes() });
    } else {
      void draftsQuery.refetch();
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    // 분류 단계로 넘어간 큐에는 새 파일을 섞지 않습니다.
    if (!importStage) return;
    addFiles(Array.from(event.dataTransfer.files));
  }

  const toUpload = () => navigate("/t/today/upload");
  const importStage = isImportStage(items);
  const importing = items.length > 0 && !isImportDone(items);

  if (importStage && rejected.length > 0 && !importing) {
    return (
      <>
        <TodayUploadFailed
          total={items.length + rejected.length}
          failures={rejected.map((fileName) => ({ fileName, reason: "unsupported" }))}
          // 연결 끊김(network)은 서버 전송 단계(처리 중 화면)에서만 생겨 이 화면에는 오지 않습니다.
          onRetryAll={() => {}}
          onRetry={() => {}}
          onRemove={(failure) => removeRejected(failure.fileName)}
          onViewCompleted={toUpload}
          onPickMore={() => pickerRef.current?.click()}
        />
        <input
          ref={pickerRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          aria-label="자료 파일 선택"
          className="hidden"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </>
    );
  }

  if (importStage && items.length > 0) {
    return (
      <TodayUploading
        teacherName={isTeacher(me) ? me.name : ""}
        photos={importCount(items, "photo")}
        videos={importCount(items, "video")}
        audios={importCount(items, "voice_memo")}
        onView={toUpload}
        onCancel={resetQueue}
      />
    );
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn("rounded-2xl", dragging && "bg-tint-2")}
    >
      <PageHeader eyebrow="오늘의 기록" title="오늘은 어떤 순간이 있었나요?" subtitle={subtitle} />
      {/* TODO(정은): Figma에는 빈 상태(1:1895)만 있어, 다른 상태도 같은 카드 틀에 문구와 버튼만 바꿉니다. */}
      <FocusCard centered className="min-h-140 justify-center">
        {card.kind === "loading" ? (
          <p className="text-lead text-ink-muted">오늘 기록을 확인하는 중이에요.</p>
        ) : card.kind === "error" ? (
          <>
            <h2 className="text-h3 font-bold text-ink">오늘 기록을 불러오지 못했어요</h2>
            <p role="alert" className="max-w-140 text-lead text-ink-muted">
              {failureText(card.error)}
            </p>
            <Button size="lg" onClick={retry}>
              다시 시도
            </Button>
          </>
        ) : card.kind === "review" ? (
          <>
            <img src={emptyMedia} alt="" className="size-14" />
            <h2 className="text-h3 font-bold text-ink">오늘의 초안이 준비돼 있어요</h2>
            <p className="max-w-140 text-lead text-ink-muted">
              검토를 마치지 않았거나 게시에서 뺀 아이가 있다면 이어서 확인해 주세요.
            </p>
            <Button asChild size="lg">
              <Link to={`/t/today/review/${card.childId}`}>초안 검토하기</Link>
            </Button>
            <Link to="/t/today/upload" className={TEXT_LINK_CLASS}>
              {"자료 더 올리기  →"}
            </Link>
          </>
        ) : card.kind === "generating" ? (
          <>
            <img src={emptyMedia} alt="" className="size-14" />
            <h2 className="text-h3 font-bold text-ink">초안을 만들고 있어요</h2>
            <p className="max-w-140 text-lead text-ink-muted">
              잠시 뒤 다시 들어오면 초안을 검토할 수 있어요.
            </p>
            <Link to="/t/today/upload" className={TEXT_LINK_CLASS}>
              {"자료 더 올리기  →"}
            </Link>
          </>
        ) : card.kind === "unclassified" ? (
          <>
            <img src={emptyMedia} alt="" className="size-14" />
            <h2 className="text-h3 font-bold text-ink">초안을 만들지 못한 아이가 있어요</h2>
            <p className="max-w-140 text-lead text-ink-muted">
              초안 검토 화면에서 사진을 더하거나 직접 써서 기록을 마무리해 주세요.
            </p>
            <Button asChild size="lg">
              <Link to={`/t/today/review/${card.childId}`}>확인하기</Link>
            </Button>
            <Link to="/t/today/upload" className={TEXT_LINK_CLASS}>
              {"자료 더 올리기  →"}
            </Link>
          </>
        ) : (
          <>
            <img src={emptyMedia} alt="" className="size-14" />
            <h2 className="text-h3 font-bold text-ink">아직 담긴 순간이 없어요</h2>
            {/* 자료 없는 아이는 초안 검토 화면에서 직접 씁니다. 그래서 여기엔 직접 기록 링크를 두지 않습니다. */}
            <p className="max-w-140 text-lead text-ink-muted">
              오늘 찍은 사진·영상·음성 메모를 올려 주세요.
            </p>
            <Button asChild size="lg">
              <Link to="/t/today/upload">오늘 찍은 자료 올리기</Link>
            </Button>
            <p className="text-caption text-ink-muted">파일을 이곳으로 끌어다 놓아도 돼요</p>
          </>
        )}
      </FocusCard>
    </div>
  );
}
