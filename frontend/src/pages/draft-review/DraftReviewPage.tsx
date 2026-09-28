// Figma: 53:294 (초안 검토 / 왼쪽 원아 목록)
import { CheckIcon, X } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { PublishConfirmDialog } from "./components/PublishConfirmDialog";

// TODO(김진하): documents/organization 목 API가 생기면 실제 데이터로 바꿉니다. 지금은 Figma 예시 값입니다.
interface RosterChild {
  id: string;
  name: string;
}

const ROSTER: RosterChild[] = [
  { id: "child-1", name: "김도윤" },
  { id: "child-2", name: "이하준" },
  { id: "child-3", name: "박서아" },
  { id: "child-4", name: "최지우" },
  { id: "child-5", name: "정예린" },
];

interface DraftSentence {
  id: string;
  text: string;
  // 문장별 근거입니다. 실제로는 SentenceEvidence(미디어·타임스탬프·원문)로 받습니다.
  evidence: { timestamp: string; source: string };
}

// 교사가 문장을 고치면 원문 발화 근거가 더 이상 보장되지 않으므로 근거를 끊습니다(edited).
interface EditableSentence extends DraftSentence {
  edited: boolean;
}

const DRAFT = {
  title: "작은 블록으로 큰 세상을 만들었어요",
  photoCount: 3,
  activityName: "알록달록 블록 놀이",
};

// 선택한 아이의 초안 예시입니다. 실제로는 childId로 조회합니다.
const SOURCE_SENTENCES: DraftSentence[] = [
  {
    id: "s1",
    text: "도윤이는 색색의 블록을 골라 차곡차곡 쌓아 보았어요. 높이가 달라지는 모습을 살피며 여러 번 다시 도전했답니다.",
    evidence: { timestamp: "▶  00:05부터 보기", source: "활동 영상 · 오전 10:22" },
  },
  {
    id: "s2",
    text: "“내가 더 높이 쌓아 볼게!”라고 말하며 블록을 올렸어요.",
    evidence: { timestamp: "▶  00:18부터 듣기", source: "교사 음성 메모 · 오전 10:24" },
  },
  {
    id: "s3",
    text: "놀이가 끝난 뒤에는 사용한 블록을 바구니에 함께 정리했어요.",
    evidence: { timestamp: "▶  00:41부터 보기", source: "활동 영상 · 오전 10:31" },
  },
];

function makeSentences(): EditableSentence[] {
  return SOURCE_SENTENCES.map((sentence) => ({ ...sentence, edited: false }));
}

export function DraftReviewPage() {
  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();

  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [sentences, setSentences] = useState<EditableSentence[]>(makeSentences);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedSentenceId, setSelectedSentenceId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const selectedId = childId ?? ROSTER[0]?.id;
  const selected = ROSTER.find((child) => child.id === selectedId);
  if (!selected) return null;

  const selectedChildId = selected.id;
  const isSelectedReviewed = reviewedIds.has(selectedChildId);
  const reviewedCount = reviewedIds.size;
  const allReviewed = ROSTER.every((child) => reviewedIds.has(child.id));
  const selectedSentence =
    sentences.find((sentence) => sentence.id === selectedSentenceId && !sentence.edited) ?? null;

  function approveSelected() {
    setReviewedIds((prev) => new Set(prev).add(selectedChildId));
    setConfirmed(false);
  }

  function selectChild(id: string) {
    setConfirmed(false);
    setSelectedSentenceId(null);
    setIsEditing(false);
    setSentences(makeSentences());
    navigate(`/t/today/review/${id}`);
  }

  function toggleEditing() {
    setSelectedSentenceId(null);
    setIsEditing((prev) => !prev);
  }

  function updateSentence(id: string, text: string) {
    const original = SOURCE_SENTENCES.find((sentence) => sentence.id === id)?.text;
    setSentences((prev) =>
      prev.map((sentence) =>
        sentence.id === id ? { ...sentence, text, edited: text !== original } : sentence,
      ),
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="오늘의 기록  /  초안 검토"
        title="오늘의 기록을 완성해요"
        subtitle="2026년 9월 15일 화요일  ·  햇살반"
      />

      <div className="flex items-start gap-5">
        {/* 왼쪽 원아 목록 */}
        <aside className="flex w-55 shrink-0 flex-col gap-4 rounded-xl bg-paper p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-lead font-bold text-ink">햇살반 원아</h2>
            <p className="text-label text-ink-muted">
              {reviewedCount} / {ROSTER.length}명 검토 완료
            </p>
          </div>
          <ul className="flex flex-col gap-1">
            {ROSTER.map((child) => {
              const reviewed = reviewedIds.has(child.id);
              const isSelected = child.id === selected.id;
              return (
                <li key={child.id}>
                  <button
                    type="button"
                    onClick={() => selectChild(child.id)}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md p-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      isSelected ? "bg-brand" : "hover:bg-tint-2",
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border",
                          reviewed
                            ? "border-transparent bg-brand-ink text-paper"
                            : isSelected
                              ? "border-ink bg-paper"
                              : "border-line bg-paper",
                        )}
                      >
                        {reviewed ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
                      </span>
                      <span className={cn("text-nav text-ink", isSelected && "font-bold")}>
                        {child.name}
                      </span>
                    </span>
                    {reviewed ? (
                      <span className="text-label text-brand-ink">검토 완료</span>
                    ) : (
                      <span className="text-label text-ink-muted">검토 필요</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-label text-ink-muted">자료 없는 아이는 직접 작성할 수 있어요.</p>
        </aside>

        {/* 가운데 초안 본문 */}
        <section className="flex min-w-0 flex-1 flex-col gap-3.5">
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: DRAFT.photoCount }).map((_, index) => (
              <div key={index} className="aspect-square rounded-lg bg-neutral-soft" />
            ))}
          </div>
          <p className="text-caption text-ink-muted">
            선택 사진 {DRAFT.photoCount}장 · {DRAFT.activityName}
          </p>

          <div className="flex flex-col gap-3.5 rounded-xl bg-paper p-7">
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-brand px-6 py-1.5 text-body font-bold text-brand-ink">
                알림장
              </span>
              <span className="text-caption text-ink-muted">
                {isEditing ? "수정 중" : "방금 저장됨"}
              </span>
            </div>
            <h3 className="text-h3 font-bold text-ink">{DRAFT.title}</h3>

            {isEditing
              ? sentences.map((sentence) => (
                  <Textarea
                    key={sentence.id}
                    value={sentence.text}
                    rows={2}
                    aria-label="초안 문장 수정"
                    onChange={(event) => updateSentence(sentence.id, event.target.value)}
                  />
                ))
              : sentences.map((sentence) =>
                  sentence.edited ? (
                    // 수정된 문장은 근거가 없어 밑줄·클릭 없이 일반 문단으로 보여 줍니다.
                    <p key={sentence.id} className="text-lead text-ink">
                      {sentence.text}
                    </p>
                  ) : (
                    <button
                      key={sentence.id}
                      type="button"
                      onClick={() => setSelectedSentenceId(sentence.id)}
                      aria-pressed={sentence.id === selectedSentenceId}
                      className={cn(
                        "block text-left text-lead text-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
                        sentence.id === selectedSentenceId && "underline",
                      )}
                    >
                      {sentence.text}
                    </button>
                  ),
                )}

            <button
              type="button"
              onClick={toggleEditing}
              className="self-start text-label font-bold text-ink-muted underline-offset-4 outline-none transition-colors hover:text-brand-ink hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {isEditing ? "수정 완료" : "직접 수정"}
            </button>
          </div>
        </section>

        {/* 오른쪽 근거 사이드바 */}
        <aside className="flex w-58 shrink-0 flex-col gap-5 rounded-xl border border-line bg-paper p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lead font-bold text-ink">근거 상세</h3>
            {selectedSentence ? (
              <button
                type="button"
                onClick={() => setSelectedSentenceId(null)}
                aria-label="근거 상세 닫기"
                className="text-ink-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          {selectedSentence ? (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-caption text-ink-muted">선택한 문장</p>
                <div className="rounded-md bg-brand px-3.5 py-3">
                  <p className="text-body font-bold text-ink">{selectedSentence.text}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-caption text-ink-muted">근거 발화</p>
                <div className="flex flex-col gap-1.5 rounded-md border border-line bg-canvas px-3.5 py-3">
                  <p className="text-label font-bold text-ink">
                    {selectedSentence.evidence.timestamp}
                  </p>
                  <p className="text-caption text-ink-muted">{selectedSentence.evidence.source}</p>
                </div>
              </div>
              <p className="text-caption text-ink-muted">
                발화를 다시 들으며 문장이 정확한지 확인해보세요.
              </p>
            </>
          ) : (
            <p className="text-caption text-ink-muted">
              문장을 클릭하면 그 문장의 근거를 볼 수 있어요.
            </p>
          )}
        </aside>
      </div>

      {/* 하단 확인·실행 */}
      <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
        <p className="text-caption text-ink-muted">승인 전에는 학부모에게 공개되지 않아요.</p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-body text-ink">
            <Checkbox
              checked={confirmed}
              disabled={isSelectedReviewed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            사진과 본문을 확인했어요
          </label>
          <Button onClick={approveSelected} disabled={!confirmed || isSelectedReviewed}>
            검토 완료하고 승인하기
          </Button>
          <Button onClick={() => setPublishOpen(true)} disabled={!allReviewed}>
            게시하기
          </Button>
        </div>
      </div>

      <PublishConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        count={reviewedCount}
        onConfirm={() => navigate("/t/notes/publish/done")}
      />
    </>
  );
}
