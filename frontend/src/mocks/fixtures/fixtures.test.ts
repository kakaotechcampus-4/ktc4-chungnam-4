// frontend/CLAUDE.md §테스트의 꼭 있어야 하는 테스트 3번(H-4): 목 데이터에 연락처가 남지 않는다.
// 이름이 합성인지 실명인지는 기계로 판단할 수 없어서, 연락처·식별번호 형태만 검사합니다.
const modules = import.meta.glob(["./*.ts", "!./*.test.ts"], { eager: true });

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, into));
  else if (typeof value === "object" && value !== null) {
    Object.values(value).forEach((item) => collectStrings(item, into));
  }
  return into;
}

// 앞뒤가 다른 글자·하이픈에 붙어 있으면 연락처가 아닙니다(UUID "…-0000-4000-8000-…"가 걸리지 않게).
const PHONE = /(?<![\w-])(01[016789]-?\d{3,4}-?\d{4}|0\d{1,2}-\d{3,4}-\d{4})(?![\w-])/;
const RESIDENT_NUMBER = /(?<![\w-])\d{6}-?[1-4]\d{6}(?![\w-])/;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

describe("목 픽스처", () => {
  const strings = collectStrings(Object.values(modules));

  it("픽스처 파일을 읽었다", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
    expect(strings.length).toBeGreaterThan(0);
  });

  it("전화번호·주민번호 형태의 값이 없다", () => {
    expect(strings.filter((text) => PHONE.test(text) || RESIDENT_NUMBER.test(text))).toEqual([]);
  });

  it("이메일은 example.com만 쓴다", () => {
    const emails = strings.flatMap((text) => text.match(EMAIL) ?? []);
    expect(emails.filter((email) => !email.endsWith("@example.com"))).toEqual([]);
  });
});
