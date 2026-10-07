import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { childDraftsQueryOptions, documentsKeys } from "@/api/documents";
import { kstToday, shiftDate } from "@/lib/datetime";
import { updateDb } from "@/mocks/db";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { PublicationRequest } from "@/types/api-draft/documents";

import { DraftReviewPage } from "./DraftReviewPage";

// 목은 오늘을 비워 두고 어제에 검토 레일 상태를 깔아 둡니다(mocks/db.ts seedDb).
// 김도윤 검토 대기, 이하준·최지우 승인 완료, 박서아 확인 필요, 정예린 자료 없음.
// 게시는 반 전체를 하루 한 번 하므로 검토 중인 어제에는 게시된 원아가 없습니다.
const YESTERDAY = shiftDate(kstToday(), -1);
const DOYUN = fixtureId("child", 1);

function renderPage(childId = DOYUN) {
  return renderRoutes([{ path: "/t/today/review/:childId", element: <DraftReviewPage /> }], {
    initialEntry: `/t/today/review/${childId}?record_date=${YESTERDAY}`,
  });
}

/** 레일과 초안 본문이 목에서 올 때까지 기다립니다. */
async function renderAndWait() {
  renderPage();
  await screen.findByRole("button", { name: /김도윤/ });
  await screen.findByRole("heading", { name: /작은 블록/ });
}

describe("DraftReviewPage", () => {
  it("원아 레일에 목의 검토 상태가 보인다", async () => {
    await renderAndWait();

    expect(screen.getByRole("button", { name: /김도윤.*검토 필요/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /이하준.*검토 완료/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /최지우.*검토 완료/ })).toBeInTheDocument();
  });

  // 임시 결정(김진하): 미분류(박서아)와 자료 없음(정예린)은 교사가 할 일이 같아 "검토 필요"로 묶는다.
  it("미분류와 자료 없음은 검토 필요로 묶인다", async () => {
    await renderAndWait();

    expect(screen.getByRole("button", { name: /박서아.*검토 필요/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /정예린.*검토 필요/ })).toBeInTheDocument();
  });

  // H-1: 교사가 확인하지 않은 초안은 승인되지 않는다 (승인 게이트).
  it("사진과 본문을 확인하기 전에는 승인 버튼이 비활성이다", async () => {
    await renderAndWait();
    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeDisabled();
  });

  it("사진과 본문을 확인하면 승인 버튼이 활성된다", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeEnabled();
  });

  // H-1: 검토가 남은 원아가 있으면 학부모 공개(게시)를 열지 않는다.
  it("검토가 남은 원아가 있으면 게시 버튼이 비활성이다", async () => {
    await renderAndWait();
    expect(screen.getByRole("button", { name: "게시하기" })).toBeDisabled();
  });

  // 자료 없는 원아도 교사가 직접 써서 검토·승인할 수 있어야 한다.
  it("자료 없는 원아에게 직접 쓰면 초안이 생겨 승인할 수 있다", async () => {
    const user = userEvent.setup();
    renderPage(fixtureId("child", 5)); // 정예린 — 시드에 초안이 없다
    await screen.findByRole("button", { name: /정예린/ });

    // 초안이 없으면 승인할 대상이 없어 체크박스가 잠겨 있다.
    expect(screen.getByRole("checkbox")).toBeDisabled();

    await user.type(
      screen.getByRole("textbox", { name: "직접 작성" }),
      "오늘은 그림책을 보았어요.",
    );
    await user.click(screen.getByRole("button", { name: "저장하기" }));

    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  });

  // 승인은 잠금이지만 게시 전까지는 되돌릴 수 있어야 한다.
  it("승인한 초안은 다시 검토하기로 되돌려 수정할 수 있다", async () => {
    const user = userEvent.setup();
    renderPage(fixtureId("child", 2)); // 이하준 — 시드에서 승인 완료
    await screen.findByRole("button", { name: /이하준/ });

    await user.click(await screen.findByRole("button", { name: "다시 검토하기" }));

    // 되돌리면 검토 대기로 돌아가 직접 수정과 승인이 다시 열린다.
    expect(await screen.findByRole("button", { name: "직접 수정" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  });

  // 교사가 고친 문장은 원문 발화가 뒷받침한다고 볼 수 없어 서버가 근거를 끊는다.
  it("직접 수정한 문장은 근거가 끊겨 밑줄·클릭이 사라진다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    const before = screen.getByRole("button", { name: /색색의 블록을 골라/ });
    expect(before).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "직접 수정" }));
    const [firstSentence] = screen.getAllByRole("textbox", { name: "초안 문장 수정" });
    await user.type(firstSentence as HTMLElement, " 오늘도 즐거웠어요.");
    await user.click(screen.getByRole("button", { name: "수정 완료" }));

    // 고친 문장은 더 이상 근거 버튼이 아니다. 고치지 않은 문장은 그대로 남는다.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /색색의 블록을 골라/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /모래 놀이터에서/ })).toBeInTheDocument();
  });

  // 교사가 새로 쓴 문장은 원문 근거가 없으므로 밑줄·클릭 없이 문단으로만 보인다.
  it("직접 수정에서 문장을 추가할 수 있다", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("button", { name: "직접 수정" }));
    await user.click(screen.getByRole("button", { name: "+ 문장 추가" }));
    await user.type(
      screen.getByRole("textbox", { name: "새 문장" }),
      "정리 시간에 바구니를 옮겼어요.",
    );
    await user.click(screen.getByRole("button", { name: "수정 완료" }));

    expect(await screen.findByText("정리 시간에 바구니를 옮겼어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /정리 시간에 바구니/ })).not.toBeInTheDocument();
  });

  it("문장을 클릭하면 그 문장의 근거가 표시된다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    expect(
      screen.getByText("문장에 마우스를 올리면 그 문장의 근거를 볼 수 있어요."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /색색의 블록을 골라/ }));

    expect(screen.getByText(/블록을 여러 층으로 쌓고 있음/)).toBeInTheDocument();
  });

  // H-1: 게시 요청에는 승인한 초안만 담겨야 한다. 미승인 초안이 섞이면 교사가 확인하지 않은
  // 글이 그대로 학부모에게 나간다. 승인했더라도 교사가 뺀 아이는 보내지 않는다.
  it("게시할 때 승인한 초안만 보내고, 교사가 뺀 아이는 뺀다", async () => {
    const user = userEvent.setup();
    let sent: PublicationRequest | null = null;
    server.use(
      http.post(apiPath("/publications"), async ({ request }) => {
        sent = (await request.clone().json()) as PublicationRequest;
      }),
    );
    await renderAndWait();

    // 김도윤을 승인해야 검토가 남은 원아가 없어져 게시가 열린다.
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "게시하기" }));
    await user.click(await screen.findByRole("checkbox", { name: "최지우 게시" }));
    await user.click(await screen.findByRole("button", { name: "게시하기" }));

    await waitFor(() => expect(sent).not.toBeNull());
    const ids = sent!.items.map((item) => item.draft_id);
    expect(ids).toContain(fixtureId("draft", 12)); // 김도윤 — 방금 승인
    expect(ids).toContain(fixtureId("draft", 22)); // 이하준 — 시드에서 승인
    expect(ids).not.toContain(fixtureId("draft", 42)); // 최지우 — 교사가 뺌
  });

  // 아직 만드는 중인 초안은 교사가 승인할 수 없어 게시를 막지 않습니다(#88 송유진 님 방향).
  // 그래서 조용히 빠질 수 있는데, 교사는 반 전체를 보냈다고 믿게 됩니다. 모달이 알려 줘야
  // 교사가 알고 누릅니다(#107 리뷰 송유진 님).
  it("만드는 중인 초안이 있으면 게시는 열리고 모달이 빠지는 인원을 알려 준다", async () => {
    const user = userEvent.setup();
    // 박서아는 시드에서 초안 없이 미분류라 "초안 없음"으로 셉니다. 여기서는 초안이 있는데
    // 아직 만드는 중인 경우를 봐야 해서 draft 상태의 초안을 하나 넣습니다.
    updateDb((db) => {
      const draftId = fixtureId("draft", 32);
      db.drafts[draftId] = {
        draft_id: draftId,
        child_id: fixtureId("child", 3),
        class_id: fixtureId("class", 1),
        doc_type: "parent_note",
        record_date: YESTERDAY,
        status: "draft",
        version: 1,
        title: null,
        sentences: [],
        selected_media_ids: [],
        author_teacher_id: fixtureId("teacher", 1),
        author_name: "김하늘",
        approved_at: null,
        published_at: null,
        include_photos: false,
        updated_at: `${YESTERDAY}T06:40:00Z`,
      };
      db.unclassified = [];
    });
    await renderAndWait();

    expect(screen.getByRole("button", { name: /박서아.*생성 중/ })).toBeInTheDocument();

    // 김도윤을 승인하면 교사가 볼 것이 남지 않아 게시가 열립니다 — 만드는 중인 박서아는 막지 않습니다.
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "게시하기" }));

    expect(
      await screen.findByText("초안이 아직 준비되지 않은 1명은 이번 게시에서 빠져요."),
    ).toBeVisible();
  });

  // 사진을 뺀 게시는 학부모에게 글만 갑니다. 교사가 게시할 때 한 번만 정할 수 있습니다.
  it("사진도 함께 보내기를 끄면 include_photos를 false로 보낸다", async () => {
    const user = userEvent.setup();
    let sent: PublicationRequest | null = null;
    server.use(
      http.post(apiPath("/publications"), async ({ request }) => {
        sent = (await request.clone().json()) as PublicationRequest;
      }),
    );
    await renderAndWait();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "게시하기" }));
    await user.click(await screen.findByRole("checkbox", { name: "사진도 함께 보내기" }));
    await user.click(await screen.findByRole("button", { name: "게시하기" }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.include_photos).toBe(false);
  });

  // 게시하면 published_at과 include_photos가 정해집니다. 캐시를 비우지 않으면 알림장 상세가
  // 게시 전 값을 읽어 사진을 뺀 게시본에도 사진을 보여 줍니다.
  it("게시하면 그 초안의 캐시를 비운다", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage();
    await screen.findByRole("button", { name: /김도윤/ });
    await screen.findByRole("heading", { name: /작은 블록/ });
    const doyunNote = fixtureId("draft", 12);
    expect(queryClient.getQueryData(documentsKeys.draft(doyunNote))).toBeDefined();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "게시하기" }));
    await user.click(await screen.findByRole("checkbox", { name: "사진도 함께 보내기" }));
    await user.click(await screen.findByRole("button", { name: "게시하기" }));

    await waitFor(() => {
      const cached = queryClient.getQueryData(documentsKeys.draft(doyunNote));
      expect(cached).toMatchObject({ include_photos: false });
    });
  });

  // 원아별 목록(알림장 목록·상세의 ‹ ›)도 비워야 합니다. 안 비우면 게시판에는 있는데
  // 그 아이 목록에는 방금 게시한 알림장이 없습니다.
  it("게시하면 그 아이의 알림장 목록 캐시도 비운다", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage();
    await screen.findByRole("button", { name: /김도윤/ });
    await screen.findByRole("heading", { name: /작은 블록/ });

    // 게시 전에 그 아이 목록을 본 상태를 만듭니다.
    const listKey = documentsKeys.childDrafts(DOYUN, "parent_note", true);
    const before = await queryClient.fetchQuery(
      childDraftsQueryOptions(DOYUN, "parent_note", true),
    );
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "게시하기" }));
    await user.click(await screen.findByRole("button", { name: "게시하기" }));

    // 비워졌으면 다시 받아 왔을 때 어제 게시본이 늘어 있습니다.
    await waitFor(async () => {
      const after = await queryClient.fetchQuery(
        childDraftsQueryOptions(DOYUN, "parent_note", true),
      );
      expect(after.length).toBe(before.length + 1);
    });
  });

  // 게시는 HTTP 200 안에서 건별로 성공·실패가 옵니다. 실패를 두고 발행 완료로 넘어가면
  // "전달했어요"만 보여서 교사가 못 올린 원아를 영영 모릅니다.
  it("일부가 실패하면 발행 완료로 넘어가지 않고 누가 실패했는지 알린다", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(apiPath("/publications"), async ({ request }) => {
        const body = (await request.json()) as PublicationRequest;
        return HttpResponse.json({
          results: body.items.map((item, index) => ({
            draft_id: item.draft_id,
            child_id: index === 0 ? DOYUN : fixtureId("child", 2),
            status: index === 0 ? "failed" : "published",
            parent_note_id: index === 0 ? null : item.draft_id,
            version: null,
            published_at: null,
            error_code: index === 0 ? "DRAFT_VERSION_CONFLICT" : null,
          })),
        });
      }),
    );
    const { router } = renderPage();
    await screen.findByRole("button", { name: /김도윤/ });
    await screen.findByRole("heading", { name: /작은 블록/ });

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "게시하기" }));
    await user.click(await screen.findByRole("button", { name: "게시하기" }));

    expect(
      await screen.findByText(/김도윤.*게시하지 못했어요|게시하지 못했어요.*김도윤/),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).not.toBe("/t/notes/publish/done");
  });

  // 한 명만 게시돼도 날짜가 닫히면, 실패한 원아를 다시 올릴 방법이 없어집니다.
  // 승인한 것만 세면, 실패한 아이를 "다시 검토하기"로 되돌리는 순간 그날이 닫혀 실패
  // 안내까지 사라집니다. 안 나간 초안이 하나라도 있으면 열어 둬야 합니다(#108 리뷰 송유진 님).
  // 목 핸들러를 덮지 않습니다 — 덮으면 목 DB가 안 바뀌어 옛 판정으로도 통과합니다.
  it("실패한 아이를 되돌려도 날짜가 열려 있다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /김도윤/ });

    // 보호자가 없는 정예린에게 초안을 만들어 승인하면 게시에서 이 한 건만 실패합니다.
    await user.click(screen.getByRole("button", { name: /정예린/ }));
    await user.type(
      await screen.findByRole("textbox", { name: "직접 작성" }),
      "오늘은 그림책을 보았어요.",
    );
    await user.click(screen.getByRole("button", { name: "저장하기" }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));

    await user.click(screen.getByRole("button", { name: /김도윤/ }));
    await screen.findByRole("heading", { name: /작은 블록/ });
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "게시하기" }));
    await user.click(await screen.findByRole("button", { name: "게시하기" }));
    await screen.findByText(/게시하지 못했어요/);

    // 나간 아이는 레일에서 "게시됨"으로 구분됩니다 — 둘 다 "검토 완료"면 교사가 누가
    // 나갔는지 모른 채 나머지를 올리게 됩니다.
    expect(await screen.findByRole("button", { name: /이하준.*게시됨/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /정예린.*검토 완료/ })).toBeInTheDocument();

    // 실패한 정예린을 되돌려 고치려 해도 그날이 닫히면 안 됩니다.
    await user.click(screen.getByRole("button", { name: /정예린/ }));
    await user.click(await screen.findByRole("button", { name: "다시 검토하기" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /정예린.*검토 필요/ })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "게시를 마쳤어요" })).not.toBeInTheDocument();
  });

  // 게시해도 status는 approved로 남습니다. published_at까지 보지 않으면 다시 게시할 때
  // 이미 나간 알림장을 또 보내 전부 DRAFT_ALREADY_PUBLISHED로 실패합니다.
  // 목의 판정을 그대로 쓰려고 핸들러를 덮지 않습니다 — 정예린은 보호자가 없어 실제로 실패합니다.
  it("다시 게시해도 이미 나간 알림장은 또 보내지 않는다", async () => {
    const user = userEvent.setup();
    // 화면 문구만 보면 "4명은 게시하지 못했어요 — …, 정예린: …"에도 걸려서, 필터를 지워도
    // 통과합니다. 실제로 보낸 건수를 봐야 잡힙니다(#108 리뷰 송유진 님).
    const sentItems: number[] = [];
    server.events.on("request:start", ({ request }) => {
      if (request.method === "POST" && request.url.endsWith("/publications")) {
        void request
          .clone()
          .json()
          .then((body) => sentItems.push((body as PublicationRequest).items.length));
      }
    });
    renderPage();
    await screen.findByRole("button", { name: /김도윤/ });

    // 보호자가 없는 정예린에게 초안을 만들어 승인합니다. 게시하면 이 한 건만 실패합니다.
    await user.click(screen.getByRole("button", { name: /정예린/ }));
    await user.type(
      await screen.findByRole("textbox", { name: "직접 작성" }),
      "오늘은 그림책을 보았어요.",
    );
    await user.click(screen.getByRole("button", { name: "저장하기" }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));

    await user.click(screen.getByRole("button", { name: /김도윤/ }));
    await screen.findByRole("heading", { name: /작은 블록/ });
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "검토 완료하고 승인하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "게시하기" }));
    await user.click(await screen.findByRole("button", { name: "게시하기" }));
    // 실패만 알리면 나머지가 나갔는지 교사가 알 수 없습니다. 성공 수도 함께 나와야 합니다.
    expect(await screen.findByText(/명은 게시했고, 1명은 게시하지 못했어요/)).toBeInTheDocument();
    expect(screen.getByText(/정예린: 보호자가 연결되지 않았어요/)).toBeInTheDocument();

    // 다시 눌러도 이미 나간 건은 빠지므로 실패는 여전히 정예린 한 명입니다.
    await user.click(screen.getByRole("button", { name: "게시하기" }));
    await user.click(await screen.findByRole("button", { name: "게시하기" }));

    expect(await screen.findByText(/^1명은 게시하지 못했어요/)).toBeInTheDocument();
    expect(screen.getByText(/정예린: 보호자가 연결되지 않았어요/)).toBeInTheDocument();
    // 첫 게시는 승인된 네 건, 두 번째는 아직 안 나간 정예린 한 건만 보냅니다.
    await waitFor(() => expect(sentItems).toEqual([4, 1]));
  });

  // 게시를 마친 날짜를 다시 열면 고칠 수 있다고 착각하지 않도록 화면 전체가 끝난 상태가 된다.
  it("게시를 마친 날짜를 열면 검토 화면 대신 끝난 안내가 나온다", async () => {
    renderRoutes([{ path: "/t/today/review/:childId", element: <DraftReviewPage /> }], {
      initialEntry: `/t/today/review/${DOYUN}?record_date=${shiftDate(kstToday(), -2)}`,
    });

    expect(await screen.findByRole("heading", { name: "게시를 마쳤어요" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "게시하기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "직접 수정" })).not.toBeInTheDocument();
  });

  // 4번: "수정 완료" 없이 승인하면 고치기 전 문장이 승인·게시되는데 화면에는 고친 글이
  // 남아 있어 교사가 알아채지 못한다. 그래서 수정 중에는 승인 자체를 막는다.
  it("직접 수정 중에는 확인 체크와 승인 버튼이 잠긴다", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "직접 수정" }));

    // 고치기 전 문장을 보고 눌러 둔 체크라 풀리고, 승인도 잠긴다.
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeDisabled();
    expect(screen.getByText("수정을 마치면 승인할 수 있어요.")).toBeInTheDocument();

    // "수정 완료"로 빠져나오면 다시 승인할 수 있다.
    await user.click(screen.getByRole("button", { name: "수정 완료" }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  });

  // 무엇이 막혔는지 알려 줘야 교사가 다음 행동을 고를 수 있다(고정 문구 대신 응답 message).
  it("목록을 불러오지 못하면 서버가 준 문구를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/children"), () =>
        errorResponse(403, "CLASS_ACCESS_DENIED", "담당 반이 아니에요."),
      ),
    );
    renderPage();

    expect(await screen.findByText("담당 반이 아니에요.")).toBeInTheDocument();
  });
});
