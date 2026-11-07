import { ApiError } from "@/lib/api-client";
import { updateDb } from "@/mocks/db";
import { fixtureId } from "@/mocks/fixtures/ids";

import { requestDraftRevision } from "./agents";

// 기본 목 핸들러(mocks/handlers/agents.ts)의 다듬기 요청이 서버 규칙을 따르는지 함께 확인합니다.
describe("agents 요청: AI에게 다듬기", () => {
  const DOYUN_NOTE = fixtureId("draft", 12);
  const APPROVED_NOTE = fixtureId("draft", 22);

  async function versionOf(draftId: string) {
    let version = 0;
    updateDb((db) => {
      version = db.drafts[draftId]?.version ?? 0;
    });
    return version;
  }

  it("바꿀 수 있는 앞의 두 문장을 고치고 버전을 올린다", async () => {
    const version = await versionOf(DOYUN_NOTE);
    const result = await requestDraftRevision(DOYUN_NOTE, {
      instruction: " 더 구체적으로 ",
      expected_version: version,
    });

    expect(result.changed_sentence_ids).toHaveLength(2);
    expect(result.draft.version).toBe(version + 1);
    expect(result.draft.status).toBe("review");
    // 교사가 직접 고친 것이 아니므로 잠기지 않습니다.
    expect(result.draft.sentences.every((s) => !s.is_edited_by_teacher)).toBe(true);
  });

  it("직접 고친 문장과 t 문장은 바꾸지 않는다", async () => {
    updateDb((db) => {
      const sentences = db.drafts[DOYUN_NOTE]?.sentences ?? [];
      if (sentences[0]) sentences[0].is_edited_by_teacher = true;
      if (sentences[1]) sentences[1].sentence_id = "t1";
      sentences.push({
        sentence_id: "s9",
        text: "합성으로 더한 문장이에요.",
        is_edited_by_teacher: false,
        evidences: [],
      });
    });
    const result = await requestDraftRevision(DOYUN_NOTE, {
      instruction: "다듬어 주세요",
      expected_version: await versionOf(DOYUN_NOTE),
    });

    expect(result.changed_sentence_ids).toEqual(["s9"]);
  });

  it("버전이 다르면 DRAFT_VERSION_CONFLICT(409)다", async () => {
    await expect(
      requestDraftRevision(DOYUN_NOTE, { instruction: "다듬어 주세요", expected_version: 999 }),
    ).rejects.toMatchObject({ status: 409, code: "DRAFT_VERSION_CONFLICT" });
  });

  it("승인한 초안은 DRAFT_ALREADY_APPROVED(409)다", async () => {
    await expect(
      requestDraftRevision(APPROVED_NOTE, {
        instruction: "다듬어 주세요",
        expected_version: await versionOf(APPROVED_NOTE),
      }),
    ).rejects.toMatchObject({ status: 409, code: "DRAFT_ALREADY_APPROVED" });
  });

  it("없는 초안은 DRAFT_NOT_FOUND(404)다", async () => {
    await expect(
      requestDraftRevision(fixtureId("draft", 9999), {
        instruction: "다듬어 주세요",
        expected_version: 1,
      }),
    ).rejects.toMatchObject({ status: 404, code: "DRAFT_NOT_FOUND" });
  });

  it("지시문이 공백뿐이거나 500자를 넘으면 검증 오류(422)다", async () => {
    for (const instruction of ["   ", "가".repeat(501)]) {
      await expect(
        requestDraftRevision(DOYUN_NOTE, { instruction, expected_version: 1 }),
      ).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("모든 문장이 잠겼으면 REVISION_NOTHING_TO_CHANGE(409)다", async () => {
    updateDb((db) => {
      for (const sentence of db.drafts[DOYUN_NOTE]?.sentences ?? []) {
        sentence.is_edited_by_teacher = true;
      }
    });
    await expect(
      requestDraftRevision(DOYUN_NOTE, {
        instruction: "다듬어 주세요",
        expected_version: await versionOf(DOYUN_NOTE),
      }),
    ).rejects.toMatchObject({ status: 409, code: "REVISION_NOTHING_TO_CHANGE" });
  });

  it("agents.revision-fails 시나리오는 REVISION_FAILED(502)를 주고 초안을 바꾸지 않는다", async () => {
    const version = await versionOf(DOYUN_NOTE);
    window.history.replaceState(null, "", "/?mock=agents.revision-fails");
    await expect(
      requestDraftRevision(DOYUN_NOTE, { instruction: "다듬어 주세요", expected_version: version }),
    ).rejects.toMatchObject({ status: 502, code: "REVISION_FAILED" });
    expect(await versionOf(DOYUN_NOTE)).toBe(version);
  });
});
