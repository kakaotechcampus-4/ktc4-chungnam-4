import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { documentsKeys, type DraftView } from "@/api/documents";
import { kstToday, shiftDate } from "@/lib/datetime";
import { readDb, updateDb } from "@/mocks/db";
import { detail } from "@/mocks/handlers/documents";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { DraftRevisionRequest } from "@/types/api-draft/agents";

import { DraftReviewPage } from "./DraftReviewPage";

// FR-18 AI에게 다듬기 요청. 김도윤 어제 알림장(draft 12)이 검토 대기, 이하준은 승인 완료입니다.
const YESTERDAY = shiftDate(kstToday(), -1);
const DOYUN = fixtureId("child", 1);
const DOYUN_NOTE = fixtureId("draft", 12);

function renderPage(childId = DOYUN) {
  return renderRoutes([{ path: "/t/today/review/:childId", element: <DraftReviewPage /> }], {
    initialEntry: `/t/today/review/${childId}?record_date=${YESTERDAY}`,
  });
}

async function renderAndWait() {
  const rendered = renderPage();
  await screen.findByRole("heading", { name: /작은 블록/ });
  await screen.findByRole("textbox", { name: "AI에게 다듬기 요청" });
  return rendered;
}

const requestButton = () => screen.getByRole("button", { name: "AI에게 요청" });
const box = () => screen.getByRole("textbox", { name: "AI에게 다듬기 요청" });

/** 김도윤 초안의 모든 문장을 교사가 직접 고친 것으로 만듭니다(AI가 바꿀 문장이 없는 상태). */
function lockAllSentences() {
  updateDb((db) => {
    for (const sentence of db.drafts[DOYUN_NOTE]?.sentences ?? []) {
      sentence.is_edited_by_teacher = true;
    }
  });
}

describe("AI에게 다듬기 요청", () => {
  it("요청하면 다듬은 문장에 표시가 붙고 초안 캐시가 새 버전으로 바뀐다", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderAndWait();
    const before = readDb().drafts[DOYUN_NOTE]?.version ?? 0;
    expect(screen.getByText("0/500")).toBeInTheDocument();

    await user.type(box(), "  놀이 모습을 더 구체적으로 써 주세요  ");
    await user.click(requestButton());

    expect(await screen.findByRole("status")).toHaveTextContent("2개 문장을 다듬었어요");
    expect(screen.getAllByText("AI가 다듬음")).toHaveLength(2);
    expect(box()).toHaveValue("");
    const cached = queryClient.getQueryData<DraftView>(documentsKeys.draft(DOYUN_NOTE));
    expect(cached?.version).toBe(before + 1);
    expect(cached?.sentences.some((s) => s.is_edited_by_teacher)).toBe(false);
    // 승인 전 초안 그대로입니다(H-1).
    expect(cached?.status).toBe("review");
  });

  it("지시문 앞뒤 공백을 뗀 값과 화면의 버전을 보낸다", async () => {
    const user = userEvent.setup();
    let sent: DraftRevisionRequest | null = null;
    server.use(
      http.post(apiPath("/drafts/:draftId/revision-requests"), async ({ request }) => {
        sent = (await request.json()) as DraftRevisionRequest;
        return errorResponse(502, "REVISION_FAILED", "AI가 문장을 다듬지 못했어요.");
      }),
    );
    await renderAndWait();
    const version = readDb().drafts[DOYUN_NOTE]?.version;

    await user.type(box(), "  짧게  ");
    await user.click(requestButton());

    await waitFor(() => expect(sent).toEqual({ instruction: "짧게", expected_version: version }));
  });

  it("비었거나 500자를 넘으면 요청할 수 없다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    expect(requestButton()).toBeDisabled();

    await user.type(box(), "   ");
    expect(requestButton()).toBeDisabled();

    await user.click(box());
    await user.paste("가".repeat(501));
    expect(screen.getByText("501/500")).toBeInTheDocument();
    expect(requestButton()).toBeDisabled();
    expect(screen.getByText("500자 이내로 써 주세요.")).toBeInTheDocument();
  });

  it("바뀐 문장이 없다는 응답이면 그렇게 알리고 표시를 붙이지 않는다", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(apiPath("/drafts/:draftId/revision-requests"), () => {
        // 서버가 글자가 그대로인 문장을 바뀐 것으로 보지 않아 빈 배열을 주는 경우: 버전도 그대로입니다.
        const db = readDb();
        const draft = db.drafts[DOYUN_NOTE];
        if (!draft) throw new Error("김도윤 초안이 시드에 없습니다.");
        return HttpResponse.json({ draft: detail(db, draft), changed_sentence_ids: [] });
      }),
    );
    await renderAndWait();
    await user.type(box(), "다듬어 주세요");
    await user.click(requestButton());

    expect(await screen.findByRole("status")).toHaveTextContent("바꿀 문장이 없었어요");
    expect(screen.queryByText("AI가 다듬음")).not.toBeInTheDocument();
  });

  it("직접 고친 문장이 전부면 서버 문구를 그대로 보여 주고 지시문을 남긴다", async () => {
    const user = userEvent.setup();
    lockAllSentences();
    await renderAndWait();
    await user.type(box(), "다듬어 주세요");
    await user.click(requestButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("AI가 바꿀 수 있는 문장이 없어요");
    expect(box()).toHaveValue("다듬어 주세요");
  });

  it("승인한 초안은 이유를 보이고 잠긴다", async () => {
    renderPage(fixtureId("child", 2)); // 이하준 — 승인 완료
    const textbox = await screen.findByRole("textbox", { name: "AI에게 다듬기 요청" });
    expect(textbox).toBeDisabled();
    expect(requestButton()).toBeDisabled();
    expect(screen.getByText(/다시 검토하기’를 누르면 요청할 수 있어요/)).toBeInTheDocument();
  });

  it("직접 수정 중에는 잠기고 수정을 취소하면 열린다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    await user.click(screen.getByRole("button", { name: "직접 수정" }));

    expect(box()).toBeDisabled();
    expect(screen.getByText("문장을 수정하는 중에는 요청할 수 없어요.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "수정 취소" }));
    expect(box()).toBeEnabled();
  });

  it("버전이 밀리면 서버 문구와 안내를 보이고 초안을 다시 받는다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    updateDb((db) => {
      const draft = db.drafts[DOYUN_NOTE];
      if (draft) draft.version += 1;
    });
    let draftGets = 0;
    server.events.on("request:start", ({ request }) => {
      if (request.method === "GET" && request.url.endsWith(`/drafts/${DOYUN_NOTE}`)) draftGets += 1;
    });

    await user.type(box(), "다듬어 주세요");
    await user.click(requestButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("다른 곳에서 먼저 고쳤어요");
    expect(alert).toHaveTextContent("다시 불러왔어요");
    await waitFor(() => expect(draftGets).toBeGreaterThan(0));
    server.events.removeAllListeners();
    expect(box()).toHaveValue("다듬어 주세요");
  });

  it("AI가 실패하면(502) 문구를 보이고 지시문을 지우지 않는다", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(apiPath("/drafts/:draftId/revision-requests"), () =>
        errorResponse(502, "REVISION_FAILED", "AI가 문장을 다듬지 못했어요. 다시 요청해 주세요."),
      ),
    );
    await renderAndWait();
    await user.type(box(), "다듬어 주세요");
    await user.click(requestButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("AI가 문장을 다듬지 못했어요");
    expect(box()).toHaveValue("다듬어 주세요");
    expect(requestButton()).toBeEnabled();
    expect(screen.queryByText("AI가 다듬음")).not.toBeInTheDocument();
  });

  it("요청 중에는 로딩을 보이고 수정·승인·게시 버튼을 잠근다", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(apiPath("/drafts/:draftId/revision-requests"), async () => {
        await gate;
        return errorResponse(502, "REVISION_FAILED", "AI가 문장을 다듬지 못했어요.");
      }),
    );
    await renderAndWait();
    await user.type(box(), "다듬어 주세요");
    await user.click(requestButton());

    expect(await screen.findByRole("status")).toHaveTextContent("AI가 문장을 다듬고 있어요");
    expect(box()).toBeDisabled();
    expect(requestButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "직접 수정" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "게시하기" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();

    release();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "직접 수정" })).toBeEnabled();
  });

  it("다듬은 문장을 직접 고치면 그 문장의 표시가 사라진다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    await user.type(box(), "다듬어 주세요");
    await user.click(requestButton());
    await screen.findByText("2개 문장을 다듬었어요");

    await user.click(screen.getByRole("button", { name: "직접 수정" }));
    const [first] = screen.getAllByRole("textbox", { name: "초안 문장 수정" });
    await user.type(first as HTMLElement, " 더해요.");
    await user.click(screen.getByRole("button", { name: "수정 완료" }));

    await waitFor(() => expect(screen.getAllByText("AI가 다듬음")).toHaveLength(1));
    expect(screen.queryByText("2개 문장을 다듬었어요")).not.toBeInTheDocument();
  });

  it("다른 원아로 옮기면 다듬음 표시와 안내가 따라오지 않는다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    await user.type(box(), "다듬어 주세요");
    await user.click(requestButton());
    await screen.findByText("2개 문장을 다듬었어요");

    await user.click(screen.getByRole("button", { name: /이하준/ }));
    await screen.findByRole("button", { name: "다시 검토하기" });
    expect(screen.queryByText("AI가 다듬음")).not.toBeInTheDocument();
    expect(screen.queryByText("2개 문장을 다듬었어요")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /김도윤/ }));
    await screen.findByRole("textbox", { name: "AI에게 다듬기 요청" });
    expect(screen.queryByText("AI가 다듬음")).not.toBeInTheDocument();
  });
});
