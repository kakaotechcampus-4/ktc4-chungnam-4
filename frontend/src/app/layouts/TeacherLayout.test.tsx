import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useBlocker } from "react-router";

import { authKeys } from "@/api/auth";
import { organizationKeys } from "@/api/organization";
import { selectClass, useCurrentClassStore } from "@/features/class-context/current-class-store";
import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { TEACHER_ME } from "@/mocks/fixtures/auth";
import { fixtureId } from "@/mocks/fixtures/ids";
import { SUNSHINE_CLASS } from "@/mocks/fixtures/organization";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { TeacherLayout } from "./TeacherLayout";

function renderAt(path: string) {
  return renderRoutes(
    [{ path: "/t", Component: TeacherLayout, children: [{ path: "*", element: <p>본문</p> }] }],
    { initialEntry: path },
  );
}

/** 떠나는 이동을 막는 화면입니다. 초안 검토 화면의 회수본 경고(useBlocker)와 같습니다. */
function LeaveGuardPage() {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname,
  );
  if (blocker.state !== "blocked") return <p>고치는 중</p>;
  return (
    <>
      <button type="button" onClick={() => blocker.reset()}>
        계속 고치기
      </button>
      <button type="button" onClick={() => blocker.proceed()}>
        나가기
      </button>
    </>
  );
}

// 같은 파일에서 두 번째로 포인터를 눌러 열면 jsdom에서 Radix 메뉴가 바로 닫힙니다(ParentLayout.test.tsx와 같음). 키보드로 엽니다.
async function openClassMenu(user: UserEvent, name: RegExp) {
  const trigger = await screen.findByRole("button", { name });
  act(() => trigger.focus());
  await user.keyboard("{Enter}");
}

/** 브라우저가 새로고침 앞에서 보내는 이벤트입니다. 막혔으면 확인 창이 뜹니다. */
function reloadIsGuarded() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("TeacherLayout", () => {
  afterEach(() => {
    useCurrentClassStore.setState({ selectedClassId: null });
    useUploadQueue.getState().reset();
  });

  // 분류하던 사진이 경고 없이 사라졌습니다(11/07 배포 점검).
  it("보내지 않은 자료가 있는 동안만 새로고침 앞에서 확인을 받는다", async () => {
    renderAt("/t/today");
    await screen.findByRole("navigation", { name: "주 메뉴" });
    expect(reloadIsGuarded()).toBe(false);

    act(() => useUploadQueue.getState().addFiles([new File(["x"], "IMG_1.jpg")]));
    expect(reloadIsGuarded()).toBe(true);

    act(() => useUploadQueue.getState().reset());
    expect(reloadIsGuarded()).toBe(false);
  });

  it("메뉴 다섯 개와 본문을 보여 준다", async () => {
    renderAt("/t/today");

    const menu = await screen.findByRole("navigation", { name: "주 메뉴" });
    expect(
      within(menu)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["오늘의 기록", "알림장", "관찰일지", "교육 계획", "우리 반 관리"]);
    expect(within(screen.getByRole("main")).getByText("본문")).toBeInTheDocument();
  });

  it("지금 주소의 메뉴 하나만 현재 페이지로 표시한다", async () => {
    renderAt("/t/children/child-1/face");

    const menu = await screen.findByRole("navigation", { name: "주 메뉴" });
    const current = within(menu)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["우리 반 관리"]);
  });

  it("메뉴에 없는 화면에서는 아무 메뉴도 표시하지 않는다", async () => {
    renderAt("/t/settings");

    const menu = await screen.findByRole("navigation", { name: "주 메뉴" });
    expect(within(menu).queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });

  it("로고는 교사 홈으로 간다", async () => {
    renderAt("/t/notes");

    expect(await screen.findByRole("link", { name: "아이담" })).toHaveAttribute("href", "/t");
  });
  // 목 API를 쓰는 컴포넌트 테스트 예시입니다. 성공은 기본 핸들러, 빈 상태는 server.use로 덮어씁니다.
  it("어린이집과 반 이름을 /classes에서 받아 보여 준다", async () => {
    // 기본 픽스처는 예전 고정값과 같은 이름이라, 다른 이름으로 응답해서 응답으로 그리는지 확인합니다.
    server.use(
      http.get(apiPath("/classes"), () =>
        listResponse([{ ...SUNSHINE_CLASS, center_name: "달님어린이집", name: "달님반" }]),
      ),
    );
    renderAt("/t/today");

    expect(await screen.findByText("달님어린이집 / 달님반")).toBeInTheDocument();
  });

  it("반을 골랐으면 첫 번째 반이 아니라 고른 반을 보여 준다", async () => {
    const star = { ...SUNSHINE_CLASS, class_id: fixtureId("class", 2), name: "별님반" };
    server.use(http.get(apiPath("/classes"), () => listResponse([SUNSHINE_CLASS, star])));
    selectClass(star.class_id);
    renderAt("/t/today");

    expect(await screen.findByText("햇살어린이집 / 별님반")).toBeInTheDocument();
  });

  it("올리지 않은 자료가 있으면 다른 반을 고를 수 없다", async () => {
    const user = userEvent.setup();
    const star = { ...SUNSHINE_CLASS, class_id: fixtureId("class", 2), name: "별님반" };
    server.use(http.get(apiPath("/classes"), () => listResponse([SUNSHINE_CLASS, star])));
    renderAt("/t/today");
    act(() => useUploadQueue.getState().addFiles([new File(["x"], "IMG_1.jpg")]));

    await openClassMenu(user, /햇살반/);

    expect(
      await screen.findByText(/올리지 않은 자료가 있어 반을 바꿀 수 없어요/),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /별님반/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(useCurrentClassStore.getState().selectedClassId).toBeNull();
  });

  it("반 이름을 누르면 같은 어린이집의 다른 반으로 바꾸고 보던 메뉴의 첫 화면을 연다", async () => {
    const user = userEvent.setup();
    const star = { ...SUNSHINE_CLASS, class_id: fixtureId("class", 2), name: "별님반" };
    server.use(http.get(apiPath("/classes"), () => listResponse([SUNSHINE_CLASS, star])));
    const { router } = renderAt("/t/observations/child-1");

    await openClassMenu(user, /햇살반/);
    expect(await screen.findByRole("menuitem", { name: /햇살반/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // 반은 주소에 없어서 새 탭으로 열 수 있는 링크로 두지 않습니다(새 탭이 이전 반으로 열림).
    expect(screen.getByRole("menuitem", { name: /별님반/ })).not.toHaveAttribute("href");
    await user.click(screen.getByRole("menuitem", { name: /별님반/ }));

    expect(await screen.findByText("햇살어린이집 / 별님반")).toBeInTheDocument();
    expect(useCurrentClassStore.getState().selectedClassId).toBe(star.class_id);
    expect(router.state.location.pathname).toBe("/t/observations");

    // 바꾼 뒤에도 메뉴를 다시 열 수 있고, 고른 반이 지금 반으로 보입니다.
    await openClassMenu(user, /별님반/);
    expect(await screen.findByRole("menuitem", { name: /별님반/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  // #326 리뷰: 반을 먼저 바꾸면, 떠나는 이동이 막혔을 때 반만 바뀐 채 그 화면이 다른 반의 데이터로 바뀌었습니다.
  it("떠나는 이동이 막히면 반을 바꾸지 않고, 나가기를 고르면 도착한 뒤에 바꾼다", async () => {
    const user = userEvent.setup();
    const star = { ...SUNSHINE_CLASS, class_id: fixtureId("class", 2), name: "별님반" };
    server.use(http.get(apiPath("/classes"), () => listResponse([SUNSHINE_CLASS, star])));
    const { router } = renderRoutes(
      [
        {
          path: "/t",
          Component: TeacherLayout,
          children: [
            { path: "review", element: <LeaveGuardPage /> },
            { path: "*", element: <p>본문</p> },
          ],
        },
      ],
      { initialEntry: "/t/review" },
    );

    await openClassMenu(user, /햇살반/);
    await user.click(await screen.findByRole("menuitem", { name: /별님반/ }));
    await user.click(await screen.findByRole("button", { name: "계속 고치기" }));

    expect(router.state.location.pathname).toBe("/t/review");
    expect(useCurrentClassStore.getState().selectedClassId).toBeNull();
    expect(screen.getByRole("button", { name: /햇살반/ })).toBeInTheDocument();

    await openClassMenu(user, /햇살반/);
    await user.click(await screen.findByRole("menuitem", { name: /별님반/ }));
    await user.click(await screen.findByRole("button", { name: "나가기" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/t/dashboard"));
    expect(useCurrentClassStore.getState().selectedClassId).toBe(star.class_id);
    expect(await screen.findByText("햇살어린이집 / 별님반")).toBeInTheDocument();
  });

  it("뒤로 가기로 반을 바꿨던 기록에 돌아와도 반을 다시 바꾸지 않는다", async () => {
    const user = userEvent.setup();
    const star = { ...SUNSHINE_CLASS, class_id: fixtureId("class", 2), name: "별님반" };
    server.use(http.get(apiPath("/classes"), () => listResponse([SUNSHINE_CLASS, star])));
    const { router } = renderAt("/t/notes/child-1");

    // /t/notes/child-1 → /t/notes(별님반으로 바꾼 기록)
    await openClassMenu(user, /햇살반/);
    await user.click(await screen.findByRole("menuitem", { name: /별님반/ }));
    expect(await screen.findByText("햇살어린이집 / 별님반")).toBeInTheDocument();

    // /t/plans로 옮긴 뒤 다시 햇살반으로 바꿉니다.
    await act(() => router.navigate("/t/plans"));
    await openClassMenu(user, /별님반/);
    await user.click(await screen.findByRole("menuitem", { name: /햇살반/ }));
    expect(await screen.findByText("햇살어린이집 / 햇살반")).toBeInTheDocument();

    // 별님반으로 바꿨던 기록(/t/notes)으로 돌아가도 반은 햇살반 그대로입니다.
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/t/notes");
    expect(useCurrentClassStore.getState().selectedClassId).toBe(SUNSHINE_CLASS.class_id);
    expect(screen.getByText("햇살어린이집 / 햇살반")).toBeInTheDocument();
  });

  it("교사 이름을 /me에서 받아 보여 준다", async () => {
    server.use(http.get(apiPath("/me"), () => HttpResponse.json({ ...TEACHER_ME, name: "박별" })));
    renderAt("/t/today");

    expect(await screen.findByRole("link", { name: "박별 선생님" })).toHaveAttribute(
      "href",
      "/t/settings",
    );
  });

  it("계정 설정에 있으면 교사 이름 링크를 현재 페이지로 표시한다", async () => {
    renderAt("/t/settings");

    expect(await screen.findByRole("link", { name: "김하늘 선생님" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("로그인이 끊겼으면 교사 이름 자리를 비운다", async () => {
    server.use(
      http.get(apiPath("/me"), () => errorResponse(401, "UNAUTHENTICATED", "로그인이 필요해요.")),
    );
    const { queryClient } = renderAt("/t/today");

    // 응답이 온 뒤에 확인합니다. 먼저 보면 요청 전이라 항상 통과합니다.
    await waitFor(() => expect(queryClient.getQueryState(authKeys.me())?.status).toBe("error"));
    expect(screen.queryByText(/선생님$/)).not.toBeInTheDocument();
  });

  it("담당 반이 없으면 반 이름 자리를 비운다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    const { queryClient } = renderAt("/t/today");

    // 응답이 온 뒤에 확인합니다. 먼저 보면 요청 전이라 항상 통과합니다.
    await waitFor(() =>
      expect(queryClient.getQueryState(organizationKeys.classes())?.status).toBe("success"),
    );
    expect(screen.queryByText(/햇살반/)).not.toBeInTheDocument();
  });
});
