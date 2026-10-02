import { PARENT_ME, TEACHER_ME } from "@/mocks/fixtures/auth";
import type { Me, SessionCreated } from "@/types/api-draft/auth";

import { isTeacher, toMeView, toSessionBody, toSessionView } from "./auth-adapter";

describe("auth adapter", () => {
  it("교사·학부모의 /me는 문서 이름 그대로 옮긴다", () => {
    expect(toMeView(TEACHER_ME)).toEqual(TEACHER_ME);
    expect(toMeView(PARENT_ME)).toEqual(PARENT_ME);
  });

  it("문서에 없는 필드는 화면 타입으로 옮기지 않는다", () => {
    const raw = { ...TEACHER_ME, password_hash: "x" } as Me;

    expect(toMeView(raw)).not.toHaveProperty("password_hash");
  });

  it("모르는 역할은 unknown이고 역할 값만 경고로 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = { ...TEACHER_ME, account_type: "admin" } as unknown as Me;

    const me = toMeView(raw);

    expect(me.account_type).toBe("unknown");
    expect(isTeacher(me)).toBe(false);
    expect(warn).toHaveBeenCalledWith("모르는 계정 역할", "admin");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TEACHER_ME.email);
    warn.mockRestore();
  });

  it("로그인 응답의 역할도 같은 규칙으로 바꾼다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toSessionView({ account_id: "a1", account_type: "parent" })).toEqual({
      account_id: "a1",
      account_type: "parent",
    });
    expect(
      toSessionView({ account_id: "a1", account_type: "role:teacher" } as unknown as SessionCreated)
        .account_type,
    ).toBe("unknown");
    warn.mockRestore();
  });

  it("로그인 본문에는 이메일과 비밀번호만 담는다", () => {
    const input = { email: "a@example.com", password: "pw", remember: true };

    expect(toSessionBody(input)).toEqual({ email: "a@example.com", password: "pw" });
  });

  it("내 정보를 받기 전이면 교사가 아니다", () => {
    expect(isTeacher(undefined)).toBe(false);
    expect(isTeacher(null)).toBe(false);
  });
});
