import type { DocType, Evidence, EvidenceSourceType, Sentence } from "@/types/api-draft/documents";
import type { MediaType } from "@/types/api-draft/media";
import type { ClassChild } from "@/types/api-draft/organization";

import type { DraftRecord, MediaRecord } from "../db";

import { TEACHER_ME } from "./auth";

// 목 초안의 문장입니다. 모두 합성이고, 원아 이름은 fixtures/organization.ts의 합성 이름입니다.
// 합성 사진 테마(fixtures/media.ts)와 순서가 같아서, 어떤 사진이 근거인지에 따라 문장이 정해집니다.
const ACTIVITIES = [
  {
    evidence: "블록을 여러 층으로 쌓고 있음",
    log: "블록을 여러 층으로 쌓으며 높이의 변화를 탐색함.",
    note: "색색의 블록을 골라 차곡차곡 쌓아 보았어요.",
    title: "작은 블록으로 큰 세상을 만들었어요",
  },
  {
    evidence: "모래를 파며 조개껍데기를 모음",
    log: "모래를 파고 조개껍데기를 모으며 모양과 크기를 견주어 봄.",
    note: "모래 놀이터에서 작은 조개껍데기를 하나씩 모았어요.",
    title: "모래 놀이터에서 찾은 보물",
  },
  {
    evidence: "그림책 속 토끼처럼 뛰어 봄",
    log: "그림책 속 인물의 움직임을 몸으로 따라 표현함.",
    note: "그림책 속 토끼처럼 깡충깡충 뛰며 웃었어요.",
    title: "그림책 속 토끼처럼",
  },
] as const;

const SOURCE_TYPE_MAP: Record<MediaType, EvidenceSourceType> = {
  photo: "photo_observation",
  video: "video_scene",
  voice_memo: "teacher_voice_memo",
};

/** "김도윤" → "도윤이는", "박서아" → "서아는" (합성 이름은 모두 성 한 글자) */
function subjectOf(name: string) {
  const given = name.slice(1);
  const syllable = given.charCodeAt(given.length - 1) - 0xac00;
  const hasFinalConsonant = syllable >= 0 && syllable < 11172 && syllable % 28 !== 0;
  return `${given}${hasFinalConsonant ? "이는" : "는"}`;
}

function activityOf(media: MediaRecord) {
  return ACTIVITIES[media.image % ACTIVITIES.length] ?? ACTIVITIES[0];
}

/** (제안) 목록 미리보기: 본문 앞부분 최대 100자, 문장 경계에서 자름 */
export function previewOf(sentences: Sentence[]): string {
  let preview = "";
  for (const { text } of sentences) {
    const next = preview ? `${preview} ${text}` : text;
    if (next.length > 100) break;
    preview = next;
  }
  return preview || (sentences[0]?.text.slice(0, 100) ?? "");
}

interface BuildDraftsInput {
  child: ClassChild;
  recordDate: string;
  /** 이 원아에게 귀속되고 llm_allowed인 자료. 비어 있으면 부르지 않습니다(미분류). */
  evidenceMedia: MediaRecord[];
  draftIds: Record<DocType, string>;
  now: string;
}

/** 원아 한 명의 [관찰일지, 알림장] 초안. 검증을 마친 상태(verified, 검토 대기)로 만듭니다. */
export function buildDrafts({
  child,
  recordDate,
  evidenceMedia,
  draftIds,
  now,
}: BuildDraftsInput): [DraftRecord, DraftRecord] {
  const picked = evidenceMedia.slice(0, 3);
  const [first] = picked;
  const sentencesFor = (docType: DocType): Sentence[] =>
    picked.map((media, index) => {
      const activity = activityOf(media);
      const evidence: Evidence = {
        evidence_id: `ev_${String(index + 1).padStart(3, "0")}`,
        source_type: SOURCE_TYPE_MAP[media.type],
        text: activity.evidence,
        media_id: media.media_id,
        start_ms: media.type === "photo" ? null : 0,
        end_ms: null,
        captured_at: media.captured_at,
      };
      const text =
        docType === "observation_log"
          ? activity.log
          : index === 0
            ? `${subjectOf(child.name)} ${activity.note}`
            : activity.note;
      return { sentence_index: index, text, evidences: [evidence] };
    });
  const base = {
    child_id: child.child_id,
    class_id: child.class_id,
    record_date: recordDate,
    status: "verified" as const,
    version: 1,
    selected_media_ids: picked.filter((media) => media.type === "photo").map((m) => m.media_id),
    author_teacher_id: TEACHER_ME.teacher_id,
    author_name: TEACHER_ME.name,
    approved_at: null,
    published_at: null,
    include_photos: false,
    updated_at: now,
  };
  return [
    {
      ...base,
      draft_id: draftIds.observation_log,
      doc_type: "observation_log",
      title: null,
      sentences: sentencesFor("observation_log"),
    },
    {
      ...base,
      draft_id: draftIds.parent_note,
      doc_type: "parent_note",
      title: first ? activityOf(first).title : null,
      sentences: sentencesFor("parent_note"),
    },
  ];
}
