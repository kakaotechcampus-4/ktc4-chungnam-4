import { act, screen } from "@testing-library/react";

import { formatDate, kstToday, shiftDate } from "@/lib/datetime";
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

  // 사진 없이 게시해도 '선택한 사진을 보호자가 확인할 수 있어요'라고 안내했습니다(11/01 검증에서 발견).
  it("사진을 보냈다고 안내하지 않는다", async () => {
    const { router } = renderAt("/t/today/review");

    await act(() => router.navigate("/t/notes/publish/done", { state: { publishedCount: 3 } }));

    expect(screen.getByText("승인한 알림장을 보호자가 확인할 수 있어요.")).toBeInTheDocument();
    expect(screen.queryByText(/사진/)).not.toBeInTheDocument();
  });

  // 지난 날짜를 게시해도 오늘 날짜와 '오늘의 기록을 전달했어요'가 보였습니다(10/31 #209 검증에서 발견).
  it("지난 날짜를 게시했으면 그 날짜를 보여 주고 '오늘의'를 붙이지 않는다", async () => {
    const { router } = renderAt("/t/today/review");
    const yesterday = shiftDate(kstToday(), -1);

    await act(() =>
      router.navigate("/t/notes/publish/done", {
        state: { publishedCount: 2, recordDate: yesterday },
      }),
    );

    expect(screen.getByRole("heading", { name: "기록을 전달했어요" })).toBeInTheDocument();
    expect(screen.getByText(formatDate(yesterday, { weekday: false }))).toBeInTheDocument();
  });

  it("오늘 게시했으면 '오늘의 기록을 전달했어요'다", async () => {
    const { router } = renderAt("/t/today/review");

    await act(() =>
      router.navigate("/t/notes/publish/done", {
        state: { publishedCount: 1, recordDate: kstToday() },
      }),
    );

    expect(screen.getByRole("heading", { name: "오늘의 기록을 전달했어요" })).toBeInTheDocument();
  });

  // 주소로 바로 열거나 새 탭에서 열면 게시 결과가 없어 '0명'으로 보였습니다(10/30 배포 점검).
  it("게시 결과 없이 열면 게시판으로 보낸다", async () => {
    const { router } = renderAt("/t/notes/publish/done");

    expect(await screen.findByText("알림장 게시판")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/notes");
  });
});
