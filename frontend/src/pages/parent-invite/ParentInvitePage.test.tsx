import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { PARENT_ME } from "@/mocks/fixtures/auth";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import { ParentInvitePage } from "./ParentInvitePage";
const preview = {
  child_name: "합성원아",
  class_name: "합성반",
  center_name: "합성원",
  expires_at: "2026-12-01T00:00:00Z",
};
function renderPage() {
  return renderRoutes(
    [
      { path: "/invite/:inviteToken", element: <ParentInvitePage /> },
      { path: "/p", element: <p>자녀 알림장</p> },
    ],
    { initialEntry: "/invite/test-token" },
  );
}
async function agreeRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: /법정대리인/ }));
  await user.click(screen.getByRole("checkbox", { name: /개인정보 수집/ }));
  await user.click(screen.getByRole("checkbox", { name: /활동 사진/ }));
}
describe("ParentInvitePage", () => {
  beforeEach(() =>
    server.use(
      http.get(apiPath("/parent-invites/:token"), () => HttpResponse.json(preview)),
      http.get(apiPath("/me"), () => errorResponse(401, "UNAUTHORIZED", "로그인해 주세요.")),
    ),
  );
  it("새 보호자는 필수 동의 후 가입하고 선택 얼굴 동의는 기본으로 보내지 않는다", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(apiPath("/parent-invites/:token/accept"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ child_id: "child1" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: /성원아의 하루를.*함께 받아 보세요/ });
    await user.click(screen.getByRole("button", { name: "시작하기" }));
    await screen.findByRole("heading", { name: "계정 만들기" });
    const submit = screen.getByRole("button", { name: "동의하고 자녀 연결" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /얼굴 특징/ })).not.toBeChecked();
    await user.type(screen.getByLabelText("보호자 이름"), "합성보호자");
    await user.type(screen.getByLabelText("이메일"), "parent@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "test-password");
    await agreeRequired(user);
    await user.click(submit);
    expect(await screen.findByText("자녀 알림장")).toBeVisible();
    expect(bodies).toEqual([
      {
        email: "parent@example.com",
        password: "test-password",
        name: "합성보호자",
        is_legal_guardian: true,
        consents: { personal_info: true, activity_media: true, face_feature: false },
      },
    ]);
  });
  it("로그인한 보호자는 비밀번호를 다시 보내지 않고 자녀를 연결한다", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(apiPath("/me"), () => HttpResponse.json(PARENT_ME)),
      http.post(apiPath("/parent-invites/:token/accept"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ child_id: "child1" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/보호자님의 계정에 이 자녀를 연결/);
    expect(screen.queryByLabelText("비밀번호")).not.toBeInTheDocument();
    await agreeRequired(user);
    await user.click(screen.getByRole("checkbox", { name: /얼굴 특징/ }));
    await user.click(screen.getByRole("button", { name: "동의하고 자녀 연결" }));
    expect(await screen.findByText("자녀 알림장")).toBeVisible();
    expect(bodies).toEqual([
      {
        is_legal_guardian: true,
        consents: { personal_info: true, activity_media: true, face_feature: true },
      },
    ]);
  });
  it("전체 동의는 모든 항목을 체크하고 항목을 풀면 같이 풀리며, 선택 동의는 개별로 푼 대로 보낸다", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(apiPath("/me"), () => HttpResponse.json(PARENT_ME)),
      http.post(apiPath("/parent-invites/:token/accept"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ child_id: "child1" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/보호자님의 계정에 이 자녀를 연결/);
    const all = screen.getByRole("checkbox", { name: "전체 동의" });
    const face = screen.getByRole("checkbox", { name: /얼굴 특징/ });
    await user.click(all);
    expect(all).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /법정대리인/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /개인정보 수집/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /활동 사진/ })).toBeChecked();
    expect(face).toBeChecked();
    await user.click(face);
    expect(all).not.toBeChecked();
    expect(screen.getByRole("button", { name: "동의하고 자녀 연결" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "동의하고 자녀 연결" }));
    expect(await screen.findByText("자녀 알림장")).toBeVisible();
    expect(bodies).toEqual([
      {
        is_legal_guardian: true,
        consents: { personal_info: true, activity_media: true, face_feature: false },
      },
    ]);
  });
  it("이미 계정이 있으면 소개 화면에서 로그인 양식으로 바로 간다", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "이미 계정이 있어요" }));
    expect(await screen.findByRole("heading", { name: "로그인" })).toBeInTheDocument();
    expect(screen.queryByLabelText("보호자 이름")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /법정대리인/ })).not.toBeInTheDocument();
  });
  it("로그인 전 소개 화면에는 입력 양식과 동의가 없다", async () => {
    renderPage();
    await screen.findByRole("button", { name: "시작하기" });
    expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("만료되거나 사용한 링크는 입력 양식을 보여 주지 않는다", async () => {
    server.use(
      http.get(apiPath("/parent-invites/:token"), () =>
        errorResponse(410, "INVITE_UNAVAILABLE", "사용할 수 없는 초대입니다."),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("선생님께 새 링크를 요청해 주세요.");
    expect(screen.queryByRole("button", { name: "동의하고 자녀 연결" })).not.toBeInTheDocument();
  });
});
