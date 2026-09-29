import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { File as NodeFile } from "node:buffer";
import { http, HttpResponse } from "msw";

import { routes } from "@/app/router";
import type { Job } from "@/types/api-draft/agents";
import {
  isPhoto,
  type LocalMedia,
  type LocalPhoto,
  uploadTargets,
  useUploadQueue,
} from "@/features/upload-queue/upload-queue-store";
import { resetAgentsFixtures, teacherEvidence } from "@/mocks/fixtures/agents";
import { fixtureId } from "@/mocks/fixtures/ids";
import { classifiedQueue, confirmedQueue } from "@/mocks/fixtures/upload-queue";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

const DOYUN = fixtureId("child", 1);
const HAJUN = fixtureId("child", 2);
const JIWOO = fixtureId("child", 4);
const YERIN = fixtureId("child", 5);

function renderAt(path: string) {
  return renderRoutes(routes, { initialEntry: path });
}

/**
 * 처리 중 화면이 기기 안 분류를 마친 상태로 큐를 채웁니다(정은 목 픽스처).
 * 사진 1 김도윤 · 2 박서아 · 3 김도윤+이하준 · 4 이하준 · 5 얼굴 못 찾음, 영상 1, 음성 메모 1
 */
function seedQueue(items: LocalMedia[] = classifiedQueue()) {
  useUploadQueue.setState({ items });
}

/** 원아 명단은 큐보다 늦게 옵니다. 아이 카드가 뜰 때까지 기다립니다. */
async function findResultList() {
  await screen.findByRole("heading", { name: "김도윤" });
  return screen.getByRole("list", { name: "아이별 자료" });
}

function photos() {
  return useUploadQueue.getState().items.filter(isPhoto);
}

function photo(n: number): LocalPhoto {
  const found = photos().find((item) => item.client_id === fixtureId("clientPhoto", n));
  if (!found) throw new Error(`사진 ${n}번이 큐에 없습니다.`);
  return found;
}

beforeEach(() => {
  // jsdom의 File은 Node의 object URL 함수가 받지 못합니다. 미리보기 주소만 흉내 냅니다.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  useUploadQueue.getState().reset();
  resetAgentsFixtures();
});

describe("얼굴 분류 결과 · 수동 분류", () => {
  it("큐가 비었으면 자료 올리기로 안내한다", async () => {
    renderAt("/t/today/classification");

    expect(await screen.findByRole("heading", { name: "분류할 자료가 없어요" })).toBeVisible();
    expect(screen.getByRole("link", { name: "자료 올리러 가기" })).toHaveAttribute(
      "href",
      "/t/today/upload",
    );
  });

  it("분류가 끝난 큐를 아이별 카드와 미분류 카드로 보여 준다", async () => {
    seedQueue();
    renderAt("/t/today/classification");

    const list = await findResultList();
    expect(within(list).getByRole("heading", { name: "미분류 자료" })).toBeVisible();
    expect(within(list).getByRole("heading", { name: "김도윤" })).toBeVisible();
    expect(within(list).getByRole("heading", { name: "이하준" })).toBeVisible();
    expect(screen.getByText("확인 필요 1개")).toBeVisible();
    // 여러 아이가 나온 사진은 두 아이 카드에 모두 보입니다.
    const doyunCard = within(list).getByRole("heading", { name: "김도윤" }).closest("li")!;
    expect(within(doyunCard).getByText("사진 2장")).toBeVisible();
  });

  it("확인 체크를 해야 넘어가고, 넘어가면 확실한 사진만 확정해 처리 중 화면의 전송 단계로 간다", async () => {
    seedQueue();
    const user = userEvent.setup();
    const { router } = renderAt("/t/today/classification");

    const next = await screen.findByRole("button", { name: "확인한 자료로 계속" });
    expect(next).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /아이 분류/ }));
    await user.click(next);

    // 정은 님 처리 중 화면에 정리 단계가 붙기 전까지 임시 처리 화면으로 갑니다.
    expect(router.state.location.pathname).toBe("/t/today/processing-temp");
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

    expect(await screen.findByText("확인 필요 2개")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "자료 분류하기 →" }));
    expect(await screen.findByText("사진 2장")).toBeVisible();
  });

  it("수동 분류에서 아이를 골라 연결하면 확정되고, 다 처리하면 분류 결과로 돌아가 알려 준다", async () => {
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
    expect(await screen.findByRole("status")).toHaveTextContent("미분류 자료를 모두 정리했어요.");
    // LLM 허용은 분류 결과의 확인 체크에서 켭니다.
    expect(photo(5)).toMatchObject({
      review_state: "확정",
      assigned_child_ids: [JIWOO],
      llm_allowed: false,
    });
    expect(screen.getByText("확인 필요 0개")).toBeVisible();
  });

  it("수동 분류에서 제외한 사진은 업로드 목록에서 빠진다", async () => {
    seedQueue();
    const user = userEvent.setup();
    renderAt("/t/today/manual-sort");

    await user.click(await screen.findByRole("button", { name: "이 자료 제외" }));

    expect(photo(5)).toMatchObject({ review_state: "제외", excluded_reason: "기타" });
    const targets = uploadTargets(useUploadQueue.getState().items).map((item) => item.client_id);
    expect(targets).not.toContain(fixtureId("clientPhoto", 5));
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

    expect(await screen.findByRole("status")).toHaveTextContent("사진의 아이를 바꿨어요.");
    expect(photo(2).assigned_child_ids).toEqual([JIWOO]);
    const updated = await findResultList();
    expect(within(updated).getByRole("heading", { name: "최지우" })).toBeVisible();
    expect(within(updated).queryByRole("heading", { name: "박서아" })).not.toBeInTheDocument();
  });

  it("영상·음성 메모는 수동 분류에 나오지 않고 발화 탭도 없다", async () => {
    seedQueue();
    renderAt("/t/today/manual-sort");

    // 영상·음성 메모는 로컬 검수 없이 올립니다(테크스펙 ⑧).
    expect(await screen.findByText("사진 1장")).toBeVisible();
    expect(screen.queryByText(/발화/)).not.toBeInTheDocument();
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
});

describe("하루 정리 (가정 API)", () => {
  it("입구는 정리된 아이 가운데 명단 첫 아이로 보낸다", async () => {
    const { router } = renderAt("/t/today/summary");

    expect(await screen.findByRole("heading", { name: "오늘 도윤이는 이랬어요" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/t/today/children/${DOYUN}/summary`);
    const nav = screen.getByRole("navigation", { name: "정리된 아이" });
    expect(within(nav).getAllByRole("link")).toHaveLength(3);
    expect(within(nav).getByRole("link", { name: "김도윤" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("정리된 하루가 없으면 입구에서 알려 준다", async () => {
    server.use(http.get(apiPath("/classes/:classId/daily-routines"), () => listResponse([])));
    renderAt("/t/today/summary");

    expect(await screen.findByRole("heading", { name: "아직 정리된 하루가 없어요" })).toBeVisible();
  });

  it("장면을 빼면 서버에 저장되고 되돌릴 수 있다", async () => {
    const requests: unknown[] = [];
    server.events.on("request:start", ({ request }) => {
      if (request.method === "PATCH") {
        void request
          .clone()
          .json()
          .then((body) => requests.push(body));
      }
    });
    const user = userEvent.setup();
    renderAt(`/t/today/children/${DOYUN}/summary`);

    const scene = () => screen.getByText(/색종이를 반으로/).closest("li")!;
    await screen.findByText(/색종이를 반으로/);
    await user.click(within(scene()).getByRole("button", { name: "빼기" }));
    expect(await within(scene()).findByText("뺐어요")).toBeVisible();

    await user.click(within(scene()).getByRole("button", { name: "되돌리기" }));
    expect(await within(scene()).findByRole("button", { name: "빼기" })).toBeVisible();
    server.events.removeAllListeners("request:start");
    expect(requests).toEqual([{ excluded: true }, { excluded: false }]);
  });

  it("초안 만들기는 처리 중 화면의 초안 단계로 보낸다", async () => {
    renderAt(`/t/today/children/${DOYUN}/summary`);

    expect(await screen.findByRole("link", { name: /초안 만들기/ })).toHaveAttribute(
      "href",
      "/t/today/processing-temp?step=draft",
    );
  });

  it("아직 정리되지 않은 아이는 정리된 아이 보기로 안내한다", async () => {
    renderAt(`/t/today/children/${YERIN}/summary`);

    expect(await screen.findByText(/예린이의 하루는 아직 정리되지 않았어요/)).toBeVisible();
    expect(screen.getByRole("link", { name: "정리된 아이 보기" })).toHaveAttribute(
      "href",
      "/t/today/summary",
    );
  });
});

describe("임시 처리 화면 (정은 님 화면에 정리 단계가 붙기 전까지)", () => {
  function finishedJob(jobId: string, drafted: string): Job {
    const child = {
      status: "succeeded" as const,
      stage: null,
      unclassified_reason: null,
      failed_stage: null,
      error_code: null,
    };
    return {
      job_id: jobId,
      class_id: fixtureId("class", 1),
      record_date: "2026-09-29",
      status: "succeeded",
      stage: null,
      progress: { percent: 100, total_children: 1, finished_children: 1 },
      failed_stage: null,
      error_code: null,
      children: [
        {
          ...child,
          child_id: drafted,
          outcome: "drafted",
          drafts: [{ draft_id: fixtureId("draft", 1001), doc_type: "parent_note" }],
        },
      ],
      created_at: "2026-09-29T06:30:00Z",
      updated_at: "2026-09-29T06:31:00Z",
    };
  }

  it("임시 화면임을 알리고, 전송 → 정리 작업이 끝나면 하루 정리로 간다", async () => {
    const created: unknown[] = [];
    server.events.on("request:start", ({ request }) => {
      if (request.method === "POST" && request.url.endsWith("/jobs")) {
        void request
          .clone()
          .json()
          .then((body) => created.push(body));
      }
    });
    // jsdom의 File은 Node fetch가 본문으로 받지 않아 S3 PUT이 실패합니다. 정은 님 ProcessingPage.test와 같이 Node File로 바꿉니다.
    seedQueue(
      confirmedQueue().map((item) => ({
        ...item,
        file: new NodeFile(["x"], item.file.name, { type: item.file.type }) as unknown as File,
      })),
    );
    const { router } = renderAt("/t/today/processing-temp");

    expect(await screen.findByRole("note")).toHaveTextContent(
      /정은 님이 만든 처리 중 화면이 아니라/,
    );
    expect(
      await screen.findByRole("heading", { name: "아이별 하루를 정리하고 있어요", level: 1 }),
    ).toBeInTheDocument();
    await waitFor(
      () => expect(router.state.location.pathname).not.toBe("/t/today/processing-temp"),
      {
        timeout: 6000,
      },
    );
    server.events.removeAllListeners("request:start");

    // 입구를 거쳐 명단 첫 아이의 하루 정리로 갑니다. 큐는 초안 단계에서 다시 쓰므로 남아 있습니다.
    expect(await screen.findByRole("heading", { name: "오늘 도윤이는 이랬어요" })).toBeVisible();
    expect(created).toEqual([expect.objectContaining({ kind: "summary" })]);
    expect(useUploadQueue.getState().items).toHaveLength(7);
  }, 10000);

  it("?step=draft면 초안 작업만 하고, 초안이 생긴 첫 원아의 초안 검토로 가며 큐를 비운다", async () => {
    server.use(
      http.post(apiPath("/classes/:classId/jobs"), () =>
        HttpResponse.json<Job>(
          { ...finishedJob("draft-job", HAJUN), status: "pending" },
          { status: 202 },
        ),
      ),
      http.get(apiPath("/jobs/:jobId"), ({ params }) =>
        HttpResponse.json<Job>(finishedJob(String(params.jobId), HAJUN)),
      ),
    );
    seedQueue(confirmedQueue());
    const { router } = renderAt("/t/today/processing-temp?step=draft");

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/today/review/${HAJUN}`));
    expect(useUploadQueue.getState().items).toEqual([]);
  });

  it("큐가 비었으면(새로고침) 자료 올리기로 안내한다", async () => {
    renderAt("/t/today/processing-temp");

    expect(await screen.findByRole("heading", { name: "처리할 자료가 없어요" })).toBeVisible();
    expect(screen.getByRole("link", { name: "자료 올리러 가기" })).toHaveAttribute(
      "href",
      "/t/today/upload",
    );
  });
});

describe("추가 근거 (가정 API)", () => {
  it("추가 근거는 내용을 적어야 저장할 수 있다", async () => {
    const user = userEvent.setup();
    renderAt(`/t/today/children/${DOYUN}/evidence/new`);

    const save = await screen.findByRole("button", { name: "근거 저장" });
    expect(save).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "관찰 내용" }), "친구를 도왔어요.");
    expect(save).toBeEnabled();
  });

  it("추가 근거는 하루 한 건이라, 저장한 뒤에는 수정 버튼으로 바뀌고 고치면 덮어쓴다", async () => {
    seedQueue();
    const user = userEvent.setup();
    const { router } = renderAt("/t/today/classification");
    await findResultList();
    const card = () => screen.getByRole("heading", { name: "김도윤" }).closest("li")!;

    // 처음: 작성
    await user.click(within(card()).getByRole("link", { name: /추가 근거 작성.*김도윤/ }));
    await user.type(
      await screen.findByRole("textbox", { name: "관찰 내용" }),
      "나뭇잎을 비교했어요.",
    );
    await user.click(screen.getByRole("button", { name: "근거 저장" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/t/today/classification"));
    expect(await screen.findByRole("status")).toHaveTextContent("김도윤 추가 근거를 저장했어요.");
    expect(await within(card()).findByText("추가 근거 있음")).toBeVisible();

    // 두 번째: 같은 버튼이 수정으로 바뀌고, 저장된 내용이 채워져 있습니다.
    await user.click(within(card()).getByRole("link", { name: /추가 근거 수정.*김도윤/ }));
    const textbox = await screen.findByRole("textbox", { name: "관찰 내용" });
    await waitFor(() => expect(textbox).toHaveValue("나뭇잎을 비교했어요."));
    await user.clear(textbox);
    await user.type(textbox, "친구에게 나뭇잎을 보여 줬어요.");
    await user.click(screen.getByRole("button", { name: "근거 수정" }));

    expect(await screen.findByRole("status")).toHaveTextContent("김도윤 추가 근거를 수정했어요.");
    expect(teacherEvidence).toHaveLength(1);
    expect(teacherEvidence[0]).toMatchObject({
      child_id: DOYUN,
      text: "친구에게 나뭇잎을 보여 줬어요.",
    });
  });

  it("추가 근거 저장에 실패하면 화면에 남아 이유를 보여 준다", async () => {
    server.use(
      http.put(apiPath("/children/:childId/evidence/:recordDate"), () =>
        HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "관찰 내용을 적어 주세요.",
              detail: null,
            },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderAt(`/t/today/children/${DOYUN}/evidence/new`);

    await user.type(await screen.findByRole("textbox", { name: "관찰 내용" }), "친구를 도왔어요.");
    await user.click(screen.getByRole("button", { name: "근거 저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("관찰 내용을 적어 주세요.");
    expect(router.state.location.pathname).toBe(`/t/today/children/${DOYUN}/evidence/new`);
  });
});

describe("얼굴 정보", () => {
  it("사진을 고르면 벡터만 보내 등록하고, 고른 사진은 비운다", async () => {
    const requests: unknown[] = [];
    server.events.on("request:start", ({ request }) => {
      if (request.method === "PUT" && request.url.includes("/face-embedding")) {
        void request
          .clone()
          .json()
          .then((body) => requests.push(body));
      }
    });
    const user = userEvent.setup();
    renderAt(`/t/children/${DOYUN}/face`);

    const register = await screen.findByRole("button", { name: "얼굴 정보 등록 · 갱신" });
    expect(register).toBeDisabled();

    await user.upload(
      screen.getByLabelText("등록할 사진"),
      new File(["face"], "face.jpg", { type: "image/jpeg" }),
    );
    expect(screen.getByRole("img", { name: "고른 사진 1" })).toBeVisible();
    await user.click(register);

    expect(await screen.findByText("얼굴 정보를 등록했어요.")).toBeVisible();
    expect(screen.queryByRole("img", { name: "고른 사진 1" })).not.toBeInTheDocument();
    server.events.removeAllListeners("request:start");
    // H-3: 사진이 아니라 벡터와 모델 버전만 보냅니다.
    expect(Object.keys(requests[0] as object).sort()).toEqual(["embedding", "model_version"]);
  });

  it("등록에 실패하면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.put(apiPath("/children/:childId/face-embedding"), () =>
        HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "얼굴 정보를 만들지 못했어요.",
              detail: null,
            },
          },
          { status: 422 },
        ),
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
        HttpResponse.json(
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "잠시 후 다시 시도해 주세요.",
              detail: null,
            },
          },
          { status: 500 },
        ),
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
  "/t/today/children/nope/evidence/new",
  "/t/children/nope/face",
  "/t/children/nope/face/delete",
])("명단에 없는 아이 주소(%s)는 404를 보여 준다", async (path) => {
  renderAt(path);

  expect(
    await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
  ).toBeInTheDocument();
});
