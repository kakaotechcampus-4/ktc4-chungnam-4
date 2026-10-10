import { QueryClient } from "@tanstack/react-query";

import { createJob, isJobFinished, jobQueryOptions, type JobView } from "@/api/agents";
import {
  approveDraft,
  classDraftsQueryOptions,
  draftQueryOptions,
  parentNoteQueryOptions,
  parentNotesQueryOptions,
  patchDraft,
  publishParentNotes,
} from "@/api/documents";
import {
  completeUpload,
  faceEmbeddingsQueryOptions,
  requestUploadUrls,
  saveChildLinks,
  uploadFile,
} from "@/api/media";
import {
  classChildrenQueryOptions,
  classesQueryOptions,
  myChildrenQueryOptions,
} from "@/api/organization";
import { kstToday, shiftDate } from "@/lib/datetime";
import type { ChildLink } from "@/types/api-draft/media";
import { FACE_DESCRIPTOR_LENGTH } from "@/workers/face/types";

import { updateDb } from "./db";
import { fixtureId } from "./fixtures/ids";
import { SUNSHINE_CLASS } from "./fixtures/organization";
import { setMockSession } from "./session";

// 핵심 흐름 목(mocks/db.ts)이 단계 사이에서 이어지는지, 목에서도 판정 규칙을 지키는지 API 수준에서 확인합니다.
// 화면 테스트가 아니라 목의 계약 테스트입니다. 화면은 각자 이 목 위에서 만듭니다.

const CLASS_ID = SUNSHINE_CLASS.class_id;
const DOYUN = fixtureId("child", 1); // 학부모 김서연의 자녀
const HAJUN = fixtureId("child", 2);
const YERIN = fixtureId("child", 5); // ③ 얼굴특징정보처리 미동의

// jsdom의 Blob은 Node fetch가 본문으로 읽지 못해서 테스트는 바이트로 올립니다. 화면은 File을 넘깁니다.
const FILE_BYTES = new TextEncoder().encode("img") as Uint8Array<ArrayBuffer>;

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function manual(childId: string): ChildLink {
  return { child_id: childId, method: "manual", confidence_score: null };
}

function useScenario(name: string) {
  window.history.replaceState(null, "", `/?mock=${name}`);
}

async function uploadPhoto(n: number) {
  const clientPhotoId = fixtureId("clientPhoto", n);
  const { items } = await requestUploadUrls({
    class_id: CLASS_ID,
    items: [
      { client_photo_id: clientPhotoId, type: "photo", content_type: "image/jpeg", size_bytes: 3 },
    ],
  });
  const [item] = items;
  if (!item) throw new Error("업로드 URL이 오지 않았습니다.");
  await uploadFile(item, FILE_BYTES);
  return completeUpload({
    client_photo_id: clientPhotoId,
    class_id: CLASS_ID,
    type: "photo",
    captured_at: `${kstToday()}T01:00:00Z`,
    model_version: "buffalo_l-1.0",
  });
}

async function pollUntilDone(client: QueryClient, started: JobView) {
  let job = started;
  for (let i = 0; i < 10 && !isJobFinished(job); i += 1) {
    job = await client.fetchQuery(jobQueryOptions(started.job_id));
  }
  return job;
}

describe("핵심 흐름 목", () => {
  it("교사가 확정한 사진으로 초안을 만들고, 승인·게시한 알림장만 학부모에게 보인다", async () => {
    const client = queryClient();
    const today = kstToday();

    // 1. 업로드 → 귀속 저장. 귀속 전 llm_allowed는 false이고, ③ 미동의 원아의 사진은 교사가 체크해도 false입니다.
    const doyunPhoto = await uploadPhoto(900);
    const yerinPhoto = await uploadPhoto(901);
    expect(doyunPhoto).toMatchObject({ llm_allowed: false, attributed_at: null });
    const doyunLinks = await saveChildLinks(doyunPhoto.media_id, {
      llm_allowed: true,
      child_links: [manual(DOYUN)],
    });
    const yerinLinks = await saveChildLinks(yerinPhoto.media_id, {
      llm_allowed: true,
      child_links: [manual(YERIN)],
    });
    expect(doyunLinks.llm_allowed).toBe(true);
    expect(yerinLinks.llm_allowed).toBe(false);

    // 2. Job → 폴링. 근거가 있는 원아만 초안이 생기고, 근거가 없으면 미분류로 끝납니다.
    const started = await createJob(CLASS_ID, {
      request_id: fixtureId("request", 900),
      record_date: today,
      media_ids: [doyunPhoto.media_id, yerinPhoto.media_id],
    });
    expect(started).toMatchObject({ status: "pending", stage: null });
    const job = await pollUntilDone(client, started);
    expect(job).toMatchObject({ status: "succeeded", stage: null });
    expect(job.progress).toEqual({ percent: 100, total_children: 2, finished_children: 2 });
    expect(job.children.find((c) => c.child_id === YERIN)).toMatchObject({
      outcome: "unclassified",
      unclassified_reason: "insufficient_evidence",
      drafts: [],
    });
    const noteId = job.children
      .find((c) => c.child_id === DOYUN)
      ?.drafts.find((d) => d.doc_type === "parent_note")?.draft_id;
    if (!noteId) throw new Error("김도윤의 알림장 초안이 없습니다.");

    // 3. 초안 검토. 근거는 이번에 보낸 자료 가운데 llm_allowed인 것만입니다.
    const rail = await client.fetchQuery(classDraftsQueryOptions(CLASS_ID, today));
    expect(rail.map((item) => item.child_id)).toEqual([DOYUN, YERIN]);
    expect(rail.find((item) => item.child_id === YERIN)?.unclassified).toBe(
      "insufficient_evidence",
    );
    const note = await client.fetchQuery(draftQueryOptions(noteId));
    // api/documents.ts가 화면용 모양으로 바꿔 줍니다. 검증을 마친 verified만 "review"이고,
    // 만드는 중·미분류·모르는 값은 잠깁니다(#107 리뷰).
    expect(note.status).toBe("review");
    expect(note.sentences[0]?.text).toMatch(/^도윤이는 /);
    expect(note.sentences.flatMap((s) => s.evidences.map((e) => e.media_id))).toEqual([
      doyunPhoto.media_id,
    ]);
    const edited = await patchDraft(noteId, {
      expected_version: note.version,
      sentences: [{ sentence_index: 0, text: "도윤이는 블록을 높이 쌓았어요." }],
    });
    expect(edited.version).toBe(note.version + 1);

    // 4. 승인만으로는 학부모에게 보이지 않고, 게시해야 보입니다(H-1).
    const approved = await approveDraft(noteId, {
      expected_version: edited.version,
      reviewed: true,
    });
    expect(approved.status).toBe("approved");
    setMockSession("parent");
    await expect(client.fetchQuery(parentNoteQueryOptions(noteId))).rejects.toMatchObject({
      status: 404,
      code: "PARENT_NOTE_NOT_FOUND",
    });
    setMockSession("teacher");
    const results = await publishParentNotes({
      request_id: fixtureId("request", 901),
      include_photos: true,
      items: [{ draft_id: noteId, expected_version: approved.version }],
    });
    expect(results[0]).toMatchObject({ status: "published", parent_note_id: noteId });

    // 5. 학부모 열람. 본문을 열면 읽음이 됩니다.
    setMockSession("parent");
    const children = await client.fetchQuery(myChildrenQueryOptions());
    expect(children.map((child) => child.child_id)).toEqual([DOYUN]);
    const list = await client.fetchQuery(parentNotesQueryOptions(DOYUN));
    expect(list.items[0]).toMatchObject({
      parent_note_id: noteId,
      record_date: today,
      is_read: false,
    });
    expect(list.items[0]?.photos).toHaveLength(1);
    const opened = await client.fetchQuery(parentNoteQueryOptions(noteId));
    expect(opened.content.split("\n")[0]).toBe("도윤이는 블록을 높이 쌓았어요.");
    expect(opened).not.toHaveProperty("status");
    const after = await client.fetchQuery(parentNotesQueryOptions(DOYUN));
    expect(after.items[0]?.is_read).toBe(true);
    expect(after.unread_count).toBe(list.unread_count - 1);
  });

  it("처음 상태에 어제 날짜의 초안 레일 상태가 하나씩 깔려 있다", async () => {
    const client = queryClient();
    const rail = await client.fetchQuery(
      classDraftsQueryOptions(CLASS_ID, shiftDate(kstToday(), -1)),
    );
    const state = Object.fromEntries(
      rail.map((item) => [
        item.child_id,
        item.unclassified
          ? "확인 필요"
          : item.parent_note?.published_at
            ? "게시됨"
            : item.parent_note?.status,
      ]),
    );
    // 게시는 반 전체를 하루 한 번 하므로 검토 중인 날짜에는 게시된 원아가 없습니다.
    expect(state).toEqual({
      [DOYUN]: "review",
      [fixtureId("child", 3)]: "확인 필요",
      [HAJUN]: "approved",
      [fixtureId("child", 4)]: "approved",
    });
  });
});

describe("목의 판정 규칙", () => {
  it("학부모와 로그인 안 한 사용자는 교사 API를 부를 수 없고, 다른 반은 403이다", async () => {
    const body = { class_id: CLASS_ID, items: [] };
    setMockSession("parent");
    await expect(requestUploadUrls(body)).rejects.toMatchObject({
      status: 403,
      code: "ROLE_NOT_ALLOWED",
    });
    setMockSession("none");
    await expect(requestUploadUrls(body)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    setMockSession("teacher");
    await expect(
      requestUploadUrls({ class_id: fixtureId("class", 2), items: [] }),
    ).rejects.toMatchObject({ status: 403, code: "CLASS_ACCESS_DENIED" });
  });

  it("교사용 반 목록·명단도 교사만 받는다", async () => {
    const client = queryClient();
    setMockSession("parent");
    await expect(client.fetchQuery(classesQueryOptions())).rejects.toMatchObject({
      status: 403,
      code: "ROLE_NOT_ALLOWED",
    });
    setMockSession("none");
    await expect(client.fetchQuery(classChildrenQueryOptions(CLASS_ID))).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });

  it("학부모는 남의 자녀 알림장을 게시돼 있어도 열 수 없고, 미승인 초안은 게시되지 않는다", async () => {
    const client = queryClient();
    const unapproved = fixtureId("draft", 12);
    const results = await publishParentNotes({
      request_id: fixtureId("request", 950),
      include_photos: false,
      items: [{ draft_id: unapproved, expected_version: 1 }],
    });
    expect(results[0]).toMatchObject({ status: "failed", error_code: "DRAFT_NOT_APPROVED" });

    setMockSession("parent");
    // 최지우(parent 4번의 자녀)의 그제 알림장은 게시돼 있지만 김서연에게는 없는 것과 같습니다.
    for (const draftId of [fixtureId("draft", 142), unapproved]) {
      await expect(client.fetchQuery(parentNoteQueryOptions(draftId))).rejects.toMatchObject({
        status: 404,
        code: "PARENT_NOTE_NOT_FOUND",
      });
    }
  });

  it("게시 기록이 있어도 승인 상태가 아니면 학부모에게 보이지 않는다(승인 취소 대비)", async () => {
    // 지금 API로는 만들 수 없는 상태라 저장소를 직접 바꿉니다. 게이트가 게시 여부만 보지 않는지 확인합니다.
    const published = fixtureId("draft", 102);
    updateDb((db) => {
      const draft = db.drafts[published];
      if (draft) draft.status = "verified";
    });
    setMockSession("parent");
    await expect(queryClient().fetchQuery(parentNoteQueryOptions(published))).rejects.toMatchObject(
      {
        status: 404,
      },
    );
  });

  it("화면의 버전이 오래되면 수정·승인·게시가 모두 막힌다", async () => {
    const verified = fixtureId("draft", 12); // version 1
    await expect(
      patchDraft(verified, {
        expected_version: 0,
        sentences: [{ sentence_index: 0, text: "수정" }],
      }),
    ).rejects.toMatchObject({ status: 409, code: "DRAFT_VERSION_CONFLICT" });
    await expect(
      approveDraft(verified, { expected_version: 0, reviewed: true }),
    ).rejects.toMatchObject({ status: 409, code: "DRAFT_VERSION_CONFLICT" });
    const results = await publishParentNotes({
      request_id: fixtureId("request", 960),
      include_photos: false,
      items: [{ draft_id: fixtureId("draft", 22), expected_version: 1 }], // 승인본은 version 2
    });
    expect(results[0]).toMatchObject({ status: "failed", error_code: "DRAFT_VERSION_CONFLICT" });
  });

  it("같은 날짜로 다시 만들어도 승인·게시된 문서는 그대로 남는다", async () => {
    const client = queryClient();
    const twoDaysAgo = shiftDate(kstToday(), -2);
    const started = await createJob(CLASS_ID, {
      request_id: fixtureId("request", 970),
      record_date: twoDaysAgo,
      media_ids: [fixtureId("media", 51)],
    });
    const job = await pollUntilDone(client, started);
    expect(job.children[0]?.drafts.map((d) => d.draft_id)).toEqual([
      fixtureId("draft", 101),
      fixtureId("draft", 102),
    ]);
    setMockSession("parent");
    const list = await client.fetchQuery(parentNotesQueryOptions(DOYUN));
    expect(list.items.map((note) => note.parent_note_id)).toEqual([
      fixtureId("draft", 102),
      fixtureId("draft", 202),
    ]);
  });

  it("학부모는 자기 자녀가 아닌 목록을 볼 수 없고, 게시 안 된 알림장은 404다", async () => {
    const client = queryClient();
    setMockSession("parent");
    await expect(client.fetchQuery(parentNotesQueryOptions(HAJUN))).rejects.toMatchObject({
      status: 403,
      code: "CHILD_ACCESS_DENIED",
    });
    // 어제 김도윤 알림장은 검토 대기(verified)라 학부모에게 없습니다.
    await expect(
      client.fetchQuery(parentNoteQueryOptions(fixtureId("draft", 12))),
    ).rejects.toMatchObject({ status: 404 });
    const list = await client.fetchQuery(parentNotesQueryOptions(DOYUN));
    expect(list.items.map((note) => note.parent_note_id)).toEqual([
      fixtureId("draft", 102),
      fixtureId("draft", 202),
    ]);
  });

  it("검토 대기가 아닌 초안은 승인할 수 없고, 확인 표시가 없으면 422다", async () => {
    const approvedNote = fixtureId("draft", 22);
    await expect(
      approveDraft(approvedNote, { expected_version: 2, reviewed: true }),
    ).rejects.toMatchObject({ status: 409, code: "DRAFT_NOT_APPROVABLE" });
    await expect(
      approveDraft(fixtureId("draft", 12), {
        expected_version: 1,
        reviewed: false as unknown as true,
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
  });

  it("귀속을 저장하지 않은 자료로는 초안 생성을 시작할 수 없다", async () => {
    const photo = await uploadPhoto(910);
    await expect(
      createJob(CLASS_ID, {
        request_id: fixtureId("request", 910),
        record_date: kstToday(),
        media_ids: [photo.media_id],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "MEDIA_NOT_READY",
      detail: { media_ids: [photo.media_id] },
    });
  });

  it("올리지 않은 파일은 완료 통지할 수 없고, 형식이 틀리면 요청 전체를 거절한다", async () => {
    const clientPhotoId = fixtureId("clientPhoto", 920);
    await requestUploadUrls({
      class_id: CLASS_ID,
      items: [
        {
          client_photo_id: clientPhotoId,
          type: "photo",
          content_type: "image/jpeg",
          size_bytes: 3,
        },
      ],
    });
    await expect(
      completeUpload({
        client_photo_id: clientPhotoId,
        class_id: CLASS_ID,
        type: "photo",
        captured_at: `${kstToday()}T01:00:00Z`,
        model_version: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: "MEDIA_UPLOAD_NOT_FOUND" });
    await expect(
      requestUploadUrls({
        class_id: CLASS_ID,
        items: [
          {
            client_photo_id: clientPhotoId,
            type: "photo",
            content_type: "application/zip",
            size_bytes: 3,
          },
        ],
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "MEDIA_TYPE_NOT_ALLOWED",
      detail: { client_photo_ids: [clientPhotoId] },
    });
  });

  it("S3 PUT이 실패하면 연결 오류이고, URL을 다시 받아 올리면 이어서 등록된다", async () => {
    useScenario("media.s3-put-fails");
    const clientPhotoId = fixtureId("clientPhoto", 930);
    const request = {
      class_id: CLASS_ID,
      items: [
        {
          client_photo_id: clientPhotoId,
          type: "photo" as const,
          content_type: "image/png",
          size_bytes: 3,
        },
      ],
    };
    const [first] = (await requestUploadUrls(request)).items;
    if (!first) throw new Error("업로드 URL이 오지 않았습니다.");
    await expect(uploadFile(first, FILE_BYTES)).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });

    useScenario("");
    const [retry] = (await requestUploadUrls(request)).items;
    if (!retry) throw new Error("업로드 URL이 오지 않았습니다.");
    await uploadFile(retry, FILE_BYTES);
    const complete = {
      client_photo_id: clientPhotoId,
      class_id: CLASS_ID,
      type: "photo" as const,
      captured_at: `${kstToday()}T01:00:00Z`,
      model_version: null,
    };
    const registered = await completeUpload(complete);
    // 응답을 못 받고 다시 보내도 같은 파일이고, URL을 다시 청하면 media_id가 와서 올리지 않습니다.
    expect((await completeUpload(complete)).media_id).toBe(registered.media_id);
    expect((await requestUploadUrls(request)).items[0]).toMatchObject({
      media_id: registered.media_id,
      upload_url: null,
    });
  });

  it("얼굴 임베딩은 ③ 동의 원아만 준다", async () => {
    const embeddings = await queryClient().fetchQuery(faceEmbeddingsQueryOptions(CLASS_ID));
    expect(embeddings.map((item) => item.child_id)).not.toContain(YERIN);
    expect(embeddings).toHaveLength(4);
    expect(embeddings[0]?.embedding).toHaveLength(FACE_DESCRIPTOR_LENGTH);
  });

  it("생성이 실패하면 그 원아와 작업이 failed로 끝난다", async () => {
    useScenario("agents.job-fails");
    const photo = await uploadPhoto(940);
    await saveChildLinks(photo.media_id, { llm_allowed: true, child_links: [manual(DOYUN)] });
    const started = await createJob(CLASS_ID, {
      request_id: fixtureId("request", 940),
      record_date: kstToday(),
      media_ids: [photo.media_id],
    });
    const job = await pollUntilDone(queryClient(), started);
    expect(job).toMatchObject({
      status: "failed",
      failed_stage: "generating",
      error_code: "LLM_TIMEOUT",
    });
    expect(job.children[0]).toMatchObject({ status: "failed", drafts: [] });
  });
});
