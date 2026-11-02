import { act, screen } from "@testing-library/react";

import { renderRoutes } from "@/test/render";

import { ParentNotePublishedPage } from "./ParentNotePublishedPage";

function renderAt(initialEntry: string) {
  return renderRoutes(
    [
      { path: "/t/notes/publish/done", element: <ParentNotePublishedPage /> },
      { path: "/t/notes", element: <p>알림장 게시판</p> },
      { path: "/t/today/review", element: <p>초안 검토</p> },
    ],
    { initialEntry },
  );
}

describe("ParentNotePublishedPage", () => {
  it("게시 직후에는 게시한 인원을 보여 준다", async () => {
    const { router } = renderAt("/t/today/review");

    await act(() => router.navigate("/t/notes/publish/done", { state: { publishedCount: 3 } }));

    expect(screen.getByRole("heading", { name: "3명의 알림장을 게시했어요" })).toBeInTheDocument();
  });

  // 주소로 바로 열거나 새 탭에서 열면 게시 결과가 없어 '0명'으로 보였습니다(10/30 배포 점검).
  it("게시 결과 없이 열면 게시판으로 보낸다", async () => {
    const { router } = renderAt("/t/notes/publish/done");

    expect(await screen.findByText("알림장 게시판")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/notes");
  });
});
