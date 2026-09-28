// Figma: 원안 1:3115 (추출본 Untitled 1:1618) · 후보 A 추출본 Untitled 1:3144 (타임라인·근거 열 미완성)
import { ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { findSampleChild } from "@/features/classify/sample-data";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";

import { EvidencePanel, type Quote } from "./components/EvidencePanel";
import { FeedbackCard } from "./components/FeedbackCard";
import { type Scene, SceneList } from "./components/SceneList";

// TODO(김동건): 하루 정리 API가 정해지면 목으로 옮깁니다. 지금은 Figma 예시 값(김도윤)입니다.
const SCENES: readonly Scene[] = [
  {
    id: "scene-1",
    time: "10:34",
    activity: "미술 활동",
    text: "색종이를 반으로 접어 나비를 만들었고, 다 만든 뒤 친구에게 보여주며 만드는 방법을 알려줬어요.",
    meta: "사진 3장 · 멘트 1개",
  },
  {
    id: "scene-2",
    time: "11:41",
    activity: "점심 식사",
    text: "국그릇을 두 손으로 들고 자리까지 옮겼어요. 흘린 자리는 스스로 닦았어요.",
    meta: "사진 2장 · 멘트 1개",
  },
  {
    id: "scene-3",
    time: "13:20",
    activity: "낮잠",
    text: "이불을 혼자 펴고 누웠어요.",
    meta: "사진 1장 · 멘트 없음",
  },
  {
    id: "scene-4",
    time: "15:12",
    activity: "바깥놀이",
    text: "미끄럼틀 차례를 기다리다가 뒤에 선 친구에게 먼저 타라고 양보했어요.",
    meta: "사진 6장 · 멘트 2개",
  },
];

const QUOTES: readonly Quote[] = [
  {
    id: "quote-1",
    source: "audio",
    label: "10:34 · 미술 활동",
    text: "“도윤이 나비 만들었네, 친구한테도 보여줄래?”",
  },
  {
    id: "quote-2",
    source: "photo",
    label: "11:41 · 점심 식사",
    text: "“국그릇 두 손으로 잘 들었어요”",
  },
  {
    id: "quote-3",
    source: "audio",
    label: "15:12 · 바깥놀이",
    text: "“먼저 타, 하고 양보해줬구나”",
  },
];

export function DaySummaryPage() {
  const { childId } = useParams();
  const child = findSampleChild(childId);
  // Figma는 낮잠 장면을 뺀 상태로 그립니다.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set(["scene-3"]));
  const [feedback, setFeedback] = useState("");
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  if (!child) return <NotFoundPage />;

  function toggleExcluded(sceneId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  }

  function startFeedback(prefix: string) {
    setFeedback((prev) => (prev ? `${prev}\n${prefix}` : prefix));
    feedbackRef.current?.focus();
  }

  return (
    // 아래 고정 줄(높이 96)에 마지막 카드가 가려지지 않게 그만큼 비워 둡니다.
    <div className="pb-32">
      <PageHeader
        eyebrow="오늘의 기록 / 하루 정리"
        title={`오늘 ${child.nickname}는 이랬어요`}
        subtitle="사진과 선생님 말씀에서 모은 하루입니다. 맞는지 봐주시면 이걸로 관찰일지와 알림장을 씁니다."
        actions={
          // TODO(김동건): 확인한 원아 수는 하루 정리 API가 정해지면 응답으로 바꿉니다.
          <span className="rounded-full border border-line bg-paper px-4 py-1.5 text-label text-ink">
            2 / 5명 확인
          </span>
        }
      />

      <div className="flex items-start gap-5.5">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <SceneList
            scenes={SCENES}
            sourceLabel="사진 12장 · 멘트 4개에서 모았어요"
            excluded={excluded}
            onToggleExcluded={toggleExcluded}
            onFeedback={startFeedback}
          />
          <FeedbackCard value={feedback} onChange={setFeedback} textareaRef={feedbackRef} />
        </div>
        <EvidencePanel quotes={QUOTES} quoteTotal={4} morePhotoCount={9} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper px-6">
        <div className="mx-auto flex h-24 max-w-app items-center justify-between gap-6">
          <div className="flex flex-col gap-1 font-bold">
            <p className="text-nav text-ink">이 내용으로 관찰일지와 알림장을 만듭니다</p>
            <p className="text-caption text-ink-muted">
              만든 뒤에도 문장을 직접 고치거나 다시 써달라고 하실 수 있어요.
            </p>
          </div>
          {/* 초안 검토는 documents 영역(김진하)의 today/review/:childId입니다. 등록 전에는 404가 뜹니다. */}
          <Button asChild size="lg" className="px-7 text-lead">
            <Link to={`/t/today/review/${child.id}`}>
              초안 만들기
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
