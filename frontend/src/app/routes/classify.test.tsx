import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { File as NodeFile } from "node:buffer";
import { http, HttpResponse } from "msw";

import { routes } from "@/app/router";
import {
  isPhoto,
  type LocalMedia,
  type LocalPhoto,
  uploadTargets,
  useUploadQueue,
} from "@/features/upload-queue/upload-queue-store";
import { resetAgentsFixtures, teacherEvidence } from "@/mocks/fixtures/agents";
import { fixtureId } from "@/mocks/fixtures/ids";
import { resetTranscriptFixtures } from "@/mocks/fixtures/transcripts";
import { classifiedQueue } from "@/mocks/fixtures/upload-queue";
import { apiPath } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { TranscriptSegmentsResponse } from "@/types/api-draft/media";

const DOYUN = fixtureId("child", 1);
const HAJUN = fixtureId("child", 2);
const JIWOO = fixtureId("child", 4);

function renderAt(path: string) {
  return renderRoutes(routes, { initialEntry: path });
}

function errorBody(code: string, message: string) {
  return { error: { code, message, detail: null } };
}

/**
 * 처리 중 화면이 기기 안 분류를 마친 상태로 큐를 채웁니다(정은 목 픽스처).
 * 사진 1 김도윤 · 2 박서아 · 3 김도윤+이하준 · 4 이하준 · 5 얼굴 못 찾음, 영상 1(발화 2), 음성 메모 1(발화 2)
 * 영상·음성은 화면이 열리면 먼저 올라가 서버 STT를 탑니다. jsdom의 File은 Node fetch가 본문으로 받지 않아
 * S3 PUT이 실패하므로 정은 님 ProcessingPage.test와 같이 Node File로 바꿉니다.
 */
function seedQueue(items: LocalMedia[] = classifiedQueue()) {
  useUploadQueue.setState({
    items: items.map((item) => ({
      ...item,
      file: new NodeFile(["x"], item.file.name, {
        type: item.file.type,
        lastModified: item.file.lastModified,
      }) as unknown as File,
    })),
  });
}

/** 원아 명단은 큐보다 늦게 옵니다. 아이 카드가 뜰 때까지 기다립니다. */
async function findResultList() {
  await screen.findByRole("heading", { name: "김도윤" });
  return screen.getByRole("list", { name: "아이별 자료" });
}

/** 영상·음성이 올라가고 STT가 끝나 발화 4개가 미분류로 들어올 때까지 기다립니다. */
async function waitForSpeech() {
  await screen.findByRole("list", { name: "미분류 발화" });
}

function photos() {
  return useUploadQueue.getState().items.filter(isPhoto);
}

function photo(n: number): LocalPhoto {
  const found = photos().find((item) => item.client_id === fixtureId("clientPhoto", n));
  if (!found) throw new Error(`사진 ${n}번이 큐에 없습니다.`);
  return found;
}

function capture(method: string, matches: (url: string) => boolean) {
  const bodies: unknown[] = [];
  server.events.on("request:start", ({ request }) => {
    if (request.method === method && matches(request.url)) {
      void request
        .clone()
        .json()
        .then((body) => bodies.push(body));
    }
  });
  return bodies;
}

beforeEach(() => {
  // jsdom의 File은 Node의 object URL 함수가 받지 못합니다. 미리보기 주소만 흉내 냅니다.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  useUploadQueue.getState().reset();
  resetAgentsFixtures();
  resetTranscriptFixtures();
});

afterEach(() => {
  server.events.removeAllListeners("request:start");
});

describe("분류 결과", () => {
  it("큐가 비었으면 자료 올리기로 안내한다", async () => {
    renderAt("/t/today/classification");

    expect(await screen.findByRole("heading", { name: "분류할 자료가 없어요" })).toBeVisible();
    expect(screen.getByRole("link", { name: "자료 올리러 가기" })).toHaveAttribute(
      "href",
      "/t/today/upload",
    );
  });

  it("아이별 카드와 미분류 카드를 보여 주고, 영상·음성의 발화는 미분류로 모은다", async () => {
    seedQueue();
    renderAt("/t/today/classification");

    const list = await findResultList();
    await waitForSpeech();
    expect(within(list).getByRole("heading", { name: "미분류 자료" })).toBeVisible();
    expect(within(list).getByRole("heading", { name: "이하준" })).toBeVisible();
    // 사진 1장 + 발화 4개
    expect(screen.getByText("확인 필요 5개")).toBeVisible();
    expect(within(list).getByText("사진 1장 · 발화 4개")).toBeVisible();
    // 여러 아이가 나온 사진은 두 아이 카드에 모두 보입니다.
    const doyunCard = within(list).getByRole("heading", { name: "김도윤" }).closest("li")!;
    expect(within(doyunCard).getByText("사진 2장")).toBeVisible();
    expect(within(doyunCard).getByRole("link", { name: /오늘 하루 확인.*김도윤/ })).toHaveAttribute(
      "href",
      `/t/today/children/${DOYUN}/summary`,
    );
  });

  it("확인 체크를 해야 넘어가고, 넘어가면 확실한 사진만 확정해 전송 단계로 간다", async () => {
    seedQueue();
    const user = userEvent.setup();
    const { router } = renderAt("/t/today/classification");
    await waitForSpeech();

    const next = screen.getByRole("button", { name: "확인한 자료로 계속" });
    expect(next).toBeDisabled();
    // 블러는 하지 않으므로 "얼굴 가림" 문구가 없습니다(#83 리뷰).
    await user.click(screen.getByRole("checkbox", { name: "아이 분류를 확인했어요" }));
    await user.click(next);

    expect(router.state.location.pathname).toBe("/t/today/processing");
    expect(router.state.location.search).toBe("?step=send");
    expect(photo(3)).toMatchObject({
      review_state: "확정",
      assigned_child_ids: [DOYUN, HAJUN],
      llm_allowed: true,
    });
    // 꼭 있어야 하는 테스트 1(H-3): 교사가 확인하지 않은 사진은 업로드 목록에 없습니다.
    expect(photo(5).review_state).toBe("미검수");
    const targets = uploadTargets(useUploadQueue.getState().items).map((item) => item.client_id);
    expect(targets).not.toContain(fixtureId("clientPhoto", 5));
    expect(targets).toHaveLength(6);
  });

  it("영상·음성은 분류 확인 전에 먼저 올리고, 사진은 올리지 않는다", async () => {
    const acked = capture("POST", (url) => url.endsWith("/api/v1/media"));
    seedQueue();
    renderAt("/t/today/classification");
    await waitForSpeech();

    const clips = useUploadQueue.getState().items.filter((item) => !isPhoto(item));
    expect(clips.every((clip) => clip.upload_state === "확인됨")).toBe(true);
    expect(photos().every((item) => item.upload_state === "대기")).toBe(true);
    expect(acked.map((body) => (body as { type: string }).type).sort()).toEqual([
      "video",
      "voice_memo",
    ]);
  });

  it("발화를 글로 바꾸는 동안에는 확인을 마칠 수 없다", async () => {
    server.use(
      http.get(apiPath("/media/:mediaId/transcript-segments"), ({ params }) =>
        HttpResponse.json<TranscriptSegmentsResponse>({
          media_id: String(params.mediaId),
          transcript_status: "pending",
          items: [],
        }),
      ),
    );
    seedQueue();
    const user = userEvent.setup();
    renderAt("/t/today/classification");

    expect(await screen.findByText(/글로 바꾸고 있어요/)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "아이 분류를 확인했어요" }));
    expect(screen.getByRole("button", { name: "확인한 자료로 계속" })).toBeDisabled();
  });

  it("서버 STT가 실패하면 알리고 발화 없이 계속할 수 있다", async () => {
    server.use(
      http.get(apiPath("/media/:mediaId/transcript-segments"), ({ params }) =>
        HttpResponse.json<TranscriptSegmentsResponse>({
          media_id: String(params.mediaId),
          transcript_status: "failed",
          items: [],
        }),
      ),
    );
    seedQueue();
    const user = userEvent.setup();
    renderAt("/t/today/classification");

    expect(await screen.findByText(/발화를 얻지 못했어요/)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "아이 분류를 확인했어요" }));
    expect(screen.getByRole("button", { name: "확인한 자료로 계속" })).toBeEnabled();
  });

  it("원아 명단을 못 받으면 오류를 보여 주고 확정할 수 없다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/children"), () =>
        HttpResponse.json(errorBody("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."), {
          status: 500,
        }),
      ),
    );
    seedQueue();
    const user = userEvent.setup();
    renderAt("/t/today/classification");

    expect(await screen.findByText(/원아 명단을 불러오지 못했어요/)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "아이 분류를 확인했어요" }));
    expect(screen.getByRole("button", { name: "확인한 자료로 계속" })).toBeDisabled();
  });

  it("꼭 있어야 하는 테스트 2: 인식에 실패한 사진도 화면이 죽지 않고 수동 분류로 간다", async () => {
    seedQueue(
      classifiedQueue().map((item) =>
        item.client_id === fixtureId("clientPhoto", 1) && isPhoto(item)
          ? { ...item, classify_state: "failed" as const, candidates: [] }
          : item,
      ),
    );
    const user = userEvent.setup();
    renderAt("/t/today/classification");
    await waitForSpeech();

    expect(screen.getByText("확인 필요 6개")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "자료 분류하기 →" }));
    expect(await screen.findByRole("link", { name: "사진 2장" })).toBeVisible();
  });

  it("아이 카드의 사진을 누르면 그 사진의 아이를 바꿀 수 있다", async () => {
    seedQueue();
    const user = userEvent.setup();
    const { router } = renderAt("/t/today/classification");
    const list = await findResultList();

    const seoaCard = within(list).getByRole("heading", { name: "박서아" }).closest("li")!;
    await user.click(within(seoaCard).getByRole("link", { name: /박서아 · .* 아이 바꾸기/ }));

    expect(router.state.location.search).toBe(`?photo=${fixtureId("clientPhoto", 2)}`);
    expect(
      screen.getByRole("heading", { name: "이 자료 속 아이를 다시 골라 주세요" }),
    ).toBeVisible();
    // 지금 연결된 아이가 선택된 채로 나옵니다.
    expect(await screen.findByRole("checkbox", { name: "박서아" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "박서아" }));
    await user.click(screen.getByRole("checkbox", { name: "최지우" }));
    await user.click(screen.getByRole("button", { name: "선택한 아이에게 연결" }));

    expect(await screen.findByText("사진의 아이를 바꿨어요.")).toBeVisible();
    expect(photo(2).assigned_child_ids).toEqual([JIWOO]);
    const updated = await findResultList();
    expect(within(updated).getByRole("heading", { name: "최지우" })).toBeVisible();
    expect(within(updated).queryByRole("heading", { name: "박서아" })).not.toBeInTheDocument();
  });
});

describe("수동 분류 · 사진", () => {
  it("아이를 골라 연결하면 확정되고, 사진을 다 처리하면 분류 결과로 돌아가 알려 준다", async () => {
    seedQueue();
    const user = userEvent.setup();
    const { router } = renderAt("/t/today/manual-sort");

    expect(await screen.findByText(/처리 0 \//)).toBeVisible();
    expect(screen.getByRole("link", { name: "분류 결과로" })).toHaveAttribute(
      "href",
      "/t/today/classification",
    );
    await user.click(await screen.findByRole("checkbox", { name: "최지우" }));
    await user.click(screen.getByRole("button", { name: "선택한 아이에게 연결" }));

    expect(router.state.location.pathname).toBe("/t/today/classification");
    expect(await screen.findByText("미분류 사진을 모두 정리했어요.")).toBeVisible();
    // LLM 허용은 분류 결과의 확인 체크에서 켭니다.
    expect(photo(5)).toMatchObject({
      review_state: "확정",
      assigned_child_ids: [JIWOO],
      llm_allowed: false,
    });
    // 발화 4개는 아직 남아 있습니다.
    await waitForSpeech();
    expect(screen.getByText("확인 필요 4개")).toBeVisible();
  });

  it("제외한 사진은 업로드 목록에서 빠진다", async () => {
    seedQueue();
    const user = userEvent.setup();
    renderAt("/t/today/manual-sort");

    await user.click(await screen.findByRole("button", { name: "이 자료 제외" }));

    expect(photo(5)).toMatchObject({ review_state: "제외", excluded_reason: "기타" });
    const targets = uploadTargets(useUploadQueue.getState().items).map((item) => item.client_id);
    expect(targets).not.toContain(fixtureId("clientPhoto", 5));
  });

  it("사진 탭에는 사진만 나오고, 영상·음성은 발화 탭에 발화로 나온다", async () => {
    seedQueue();
    renderAt("/t/today/manual-sort");

    expect(await screen.findByRole("link", { name: "사진 1장" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("link", { name: "발화 4개" })).toHaveAttribute(
      "href",
      "/t/today/manual-sort?tab=speech",
    );
    expect(screen.queryByText(/VID_0113|REC_1035/)).not.toBeInTheDocument();
  });

  it("확인할 사진이 없으면 분류 결과로 돌아가게 한다", async () => {
    renderAt("/t/today/manual-sort");

    expect(await screen.findByRole("heading", { name: "확인할 사진이 없어요" })).toBeVisible();
    expect(screen.getByRole("link", { name: "분류 결과로 돌아가기" })).toHaveAttribute(
      "href",
      "/t/today/classification",
    );
  });

  it("원아 명단을 못 받으면 오류를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/children"), () =>
        HttpResponse.json(errorBody("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."), {
          status: 500,
        }),
      ),
    );
    seedQueue();
    renderAt("/t/today/manual-sort");

    expect(await screen.findByRole("alert")).toHaveTextContent("원아 명단을 불러오지 못해");
  });
});

describe("수동 분류 · 발화", () => {
  it("발화를 아이에게 연결하면 고친 문장·화자와 함께 서버에 저장한다", async () => {
    const patched = capture("PATCH", (url) => url.includes("/transcript-segments/"));
    seedQueue();
    const user = userEvent.setup();
    renderAt("/t/today/manual-sort?tab=speech");

    expect(await screen.findByText("“내가 더 높이 쌓아 볼게!”")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "인식한 문장 수정하기" }));
    const sentence = screen.getByRole("textbox", { name: "인식한 문장" });
    await user.clear(sentence);
    await user.type(sentence, "내가 제일 높이 쌓아 볼게!");
    await user.click(screen.getByRole("radio", { name: "함께 한 말" }));
    await user.click(await screen.findByRole("checkbox", { name: "김도윤" }));
    await user.click(screen.getByRole("button", { name: "선택한 아이에게 연결" }));

    // 다음 발화로 넘어갑니다.
    expect(await screen.findByText("“탑이 무너졌네. 다시 해 볼까?”")).toBeVisible();
    expect(screen.getByText("처리 1 / 4개")).toBeVisible();
    expect(patched).toEqual([
      {
        child_ids: [DOYUN],
        speaker: "together",
        excluded: false,
        text: "내가 제일 높이 쌓아 볼게!",
      },
    ]);
  });

  it("발화를 다 처리하면 분류 결과로 돌아가고, 연결한 발화는 아이 카드에 센다", async () => {
    seedQueue();
    const user = userEvent.setup();
    const { router } = renderAt("/t/today/manual-sort?tab=speech");

    await screen.findByText("“내가 더 높이 쌓아 볼게!”");
    await user.click(await screen.findByRole("checkbox", { name: "이하준" }));
    await user.click(screen.getByRole("button", { name: "선택한 아이에게 연결" }));
    // 저장 → 다음 발화로 이동을 세 번 거쳐서, 전체 테스트가 함께 돌 때는 기본 대기(1초)를 넘길 수 있습니다.
    for (let i = 0; i < 3; i += 1) {
      await screen.findByText(`처리 ${i + 1} / 4개`, undefined, { timeout: 5000 });
      await user.click(screen.getByRole("button", { name: "이 자료 제외" }));
    }

    await waitFor(() => expect(router.state.location.pathname).toBe("/t/today/classification"));
    expect(await screen.findByText("미분류 발화를 모두 정리했어요.")).toBeVisible();
    const list = await findResultList();
    const hajunCard = await waitFor(() => {
      const card = within(list).getByRole("heading", { name: "이하준" }).closest("li")!;
      expect(within(card).getByText("사진 2장 · 발화 1개")).toBeVisible();
      return card;
    });
    expect(hajunCard).toBeInTheDocument();
  });

  it("발화 저장에 실패하면 화면에 남아 이유를 보여 준다", async () => {
    server.use(
      http.patch(apiPath("/transcript-segments/:segmentId"), () =>
        HttpResponse.json(errorBody("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."), {
          status: 500,
        }),
      ),
    );
    seedQueue();
    const user = userEvent.setup();
    renderAt("/t/today/manual-sort?tab=speech");

    await screen.findByText("“내가 더 높이 쌓아 볼게!”");
    await user.click(screen.getByRole("button", { name: "이 자료 제외" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(screen.getByText("처리 0 / 4개")).toBeVisible();
  });
});

describe("아이별 하루 확인", () => {
  it("이 아이의 사진과 연결한 발화를 시간순으로 보여 주고 다른 아이로 넘어갈 수 있다", async () => {
    seedQueue();
    const user = userEvent.setup();
    renderAt("/t/today/manual-sort?tab=speech");
    await screen.findByText("“내가 더 높이 쌓아 볼게!”");
    await user.click(await screen.findByRole("checkbox", { name: "김도윤" }));
    await user.click(screen.getByRole("button", { name: "선택한 아이에게 연결" }));
    await screen.findByText("처리 1 / 4개");

    await user.click(screen.getByRole("link", { name: "분류 결과로" }));
    const list = await findResultList();
    const card = within(list).getByRole("heading", { name: "김도윤" }).closest("li")!;
    await user.click(within(card).getByRole("link", { name: /오늘 하루 확인/ }));

    expect(await screen.findByRole("heading", { name: "오늘 도윤이는 이랬어요" })).toBeVisible();
    expect(screen.getByText("사진 2장 · 발화 1개")).toBeVisible();
    expect(screen.getByText("“내가 더 높이 쌓아 볼게!”")).toBeVisible();
    expect(screen.getByText("이하준와 함께 나온 사진")).toBeVisible();
    const nav = screen.getByRole("navigation", { name: "자료가 있는 아이" });
    expect(within(nav).getByRole("link", { name: "김도윤" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "박서아" })).toHaveAttribute(
      "href",
      `/t/today/children/${fixtureId("child", 3)}/summary`,
    );
    expect(screen.getByRole("link", { name: /분류 결과로 돌아가기/ })).toHaveAttribute(
      "href",
      "/t/today/classification",
    );
  });

  it("함께 나온 사진을 빼면 이 아이만 빠지고, 되돌리면 원래대로 돌아온다", async () => {
    seedQueue();
    const user = userEvent.setup();
    renderAt(`/t/today/children/${DOYUN}/summary`);

    const row = () => screen.getByText("이하준와 함께 나온 사진").closest("li")!;
    await screen.findByText("이하준와 함께 나온 사진");
    await user.click(within(row()).getByRole("button", { name: /빼기/ }));

    expect(within(row()).getByText("뺐어요")).toBeVisible();
    expect(photo(3)).toMatchObject({ review_state: "확정", assigned_child_ids: [HAJUN] });

    await user.click(within(row()).getByRole("button", { name: "되돌리기" }));
    expect(within(row()).getByRole("button", { name: /빼기/ })).toBeVisible();
    expect(photo(3)).toMatchObject({ review_state: "미검수", assigned_child_ids: [] });
  });

  it("추가 근거는 이 화면에서 쓰고, 하루 한 건이라 다시 저장하면 덮어쓴다", async () => {
    const user = userEvent.setup();
    renderAt(`/t/today/children/${DOYUN}/summary`);

    const textbox = await screen.findByRole("textbox", { name: "관찰 내용" });
    const save = screen.getByRole("button", { name: "근거 저장" });
    expect(save).toBeDisabled();
    await waitFor(() => expect(textbox).toBeEnabled());
    await user.type(textbox, "나뭇잎을 비교했어요.");
    await user.click(save);

    expect(await screen.findByText("저장했어요.")).toBeVisible();
    expect(await screen.findByText("추가 근거 있음")).toBeVisible();
    const edit = screen.getByRole("button", { name: "근거 수정" });
    await user.clear(textbox);
    await user.type(textbox, "친구에게 나뭇잎을 보여 줬어요.");
    await user.click(edit);

    await screen.findByText("저장했어요.");
    expect(teacherEvidence).toHaveLength(1);
    expect(teacherEvidence[0]).toMatchObject({
      child_id: DOYUN,
      text: "친구에게 나뭇잎을 보여 줬어요.",
    });
  });

  it("저장된 추가 근거를 못 받으면 덮어쓰지 않게 저장을 막는다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/evidence"), () =>
        HttpResponse.json(errorBody("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."), {
          status: 500,
        }),
      ),
    );
    renderAt(`/t/today/children/${DOYUN}/summary`);

    expect(await screen.findByText(/덮어쓰지 않도록 저장을 막았어요/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "관찰 내용" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "근거 저장" })).toBeDisabled();
  });

  it("추가 근거 저장에 실패하면 이유를 보여 준다", async () => {
    server.use(
      http.put(apiPath("/children/:childId/evidence/:recordDate"), () =>
        HttpResponse.json(errorBody("VALIDATION_ERROR", "관찰 내용을 적어 주세요."), {
          status: 422,
        }),
      ),
    );
    const user = userEvent.setup();
    renderAt(`/t/today/children/${DOYUN}/summary`);

    const textbox = await screen.findByRole("textbox", { name: "관찰 내용" });
    await waitFor(() => expect(textbox).toBeEnabled());
    await user.type(textbox, "친구를 도왔어요.");
    await user.click(screen.getByRole("button", { name: "근거 저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("관찰 내용을 적어 주세요.");
  });
});

describe("얼굴 정보", () => {
  it("사진을 고르면 벡터만 보내 등록하고, 고른 사진은 비운다", async () => {
    const requests = capture("PUT", (url) => url.includes("/face-embedding"));
    const user = userEvent.setup();
    renderAt(`/t/children/${DOYUN}/face`);

    const register = await screen.findByRole("button", { name: "얼굴 정보 등록 · 갱신" });
    expect(register).toBeDisabled();
    expect(screen.getByText(/이번에 고른 사진으로 모두 바뀌어요/)).toBeVisible();

    await user.upload(
      screen.getByLabelText("등록할 사진"),
      new File(["face"], "face.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByRole("img", { name: "고른 사진 1" })).toBeVisible();
    // 1장으로도 등록할 수 있습니다(임시 결정).
    await user.click(register);

    expect(await screen.findByText("얼굴 정보를 등록했어요.")).toBeVisible();
    expect(screen.queryByRole("img", { name: "고른 사진 1" })).not.toBeInTheDocument();
    // H-3: 사진이 아니라 벡터와 모델 버전만 보냅니다.
    expect(Object.keys(requests[0] as object).sort()).toEqual(["embedding", "model_version"]);
  });

  it("등록 전에는 칸마다 사진을 뺄 수 있다", async () => {
    const user = userEvent.setup();
    renderAt(`/t/children/${DOYUN}/face`);

    await user.upload(await screen.findByLabelText("등록할 사진"), [
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    ]);
    expect(await screen.findByRole("img", { name: "고른 사진 2" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /선택 사진 제거.*등록 사진 1/ }));

    expect(screen.queryByRole("img", { name: "고른 사진 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "고른 사진 2" })).toBeVisible();
    expect(screen.getByRole("button", { name: /사진 고르기.*등록 사진 1/ })).toBeVisible();
  });

  it("등록하지 않고 나가면 미리보기 주소를 지운다", async () => {
    const user = userEvent.setup();
    renderAt(`/t/children/${DOYUN}/face`);

    await user.upload(
      await screen.findByLabelText("등록할 사진"),
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
    );
    await screen.findByRole("img", { name: "고른 사진 1" });
    vi.mocked(URL.revokeObjectURL).mockClear();
    await user.click(screen.getByRole("link", { name: "등록 정보 삭제" }));

    await screen.findByRole("button", { name: "얼굴 정보 삭제" });
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock"));
  });

  it("등록에 실패하면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.put(apiPath("/children/:childId/face-embedding"), () =>
        HttpResponse.json(errorBody("VALIDATION_ERROR", "얼굴 정보를 만들지 못했어요."), {
          status: 422,
        }),
      ),
    );
    const user = userEvent.setup();
    renderAt(`/t/children/${DOYUN}/face`);

    await user.upload(
      await screen.findByLabelText("등록할 사진"),
      new File(["x"], "a.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "얼굴 정보 등록 · 갱신" }));

    expect(await screen.findByText("얼굴 정보를 만들지 못했어요.")).toBeVisible();
  });

  it("삭제하면 얼굴 정보 화면으로 돌아와 결과를 알려 준다", async () => {
    const user = userEvent.setup();
    const { router } = renderAt(`/t/children/${DOYUN}/face`);

    expect(await screen.findByRole("link", { name: "우리 반 관리" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(await screen.findByRole("link", { name: "등록 정보 삭제" }));
    await user.click(await screen.findByRole("button", { name: "얼굴 정보 삭제" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/children/${DOYUN}/face`));
    expect(await screen.findByText("얼굴 정보를 삭제했어요.")).toBeVisible();
  });

  it("삭제에 실패하면 화면에 남아 이유를 보여 준다", async () => {
    server.use(
      http.delete(apiPath("/children/:childId/face-embedding"), () =>
        HttpResponse.json(errorBody("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."), {
          status: 500,
        }),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderAt(`/t/children/${DOYUN}/face/delete`);

    await user.click(await screen.findByRole("button", { name: "얼굴 정보 삭제" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(router.state.location.pathname).toBe(`/t/children/${DOYUN}/face/delete`);
  });
});

it.each([
  "/t/today/children/nope/summary",
  "/t/children/nope/face",
  "/t/children/nope/face/delete",
])("명단에 없는 아이 주소(%s)는 404를 보여 준다", async (path) => {
  renderAt(path);

  expect(
    await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
  ).toBeInTheDocument();
});
