import {
  formatDate,
  formatDateTime,
  formatDotDate,
  formatMediaTime,
  formatTime,
  formatWeekday,
  formatYearMonth,
  kstToday,
  toKstDate,
} from "./datetime";

// 테스트는 TZ=UTC로 돕니다. 한국 자정은 UTC 전날 15:00입니다.
describe("한국 날짜", () => {
  it.each([
    ["2026-09-14T14:59:59Z", "2026-09-14"],
    ["2026-09-14T15:00:00Z", "2026-09-15"],
    ["2026-09-15T14:59:59Z", "2026-09-15"],
    ["2026-12-31T15:00:00Z", "2027-01-01"],
  ])("kstToday(%s) → %s", (now, expected) => {
    expect(kstToday(new Date(now))).toBe(expected);
  });

  it.each([
    ["2026-09-14T15:00:00Z", "2026-09-15"],
    ["2026-09-15T00:30:00+09:00", "2026-09-15"],
    ["2026-09-15T08:59:59.999Z", "2026-09-15"],
  ])("toKstDate(%s) → %s", (iso, expected) => {
    expect(toKstDate(iso)).toBe(expected);
  });

  it.each([
    "2026-09-15T09:04:00",
    "2026-09-15",
    "2026-09-15Z",
    "2026/09/15 09:04Z",
    "2026-02-30T09:04:00Z",
    "2026-09-15T24:00:00Z",
    "어제",
    "",
  ])("시간대가 없거나 ISO 8601이 아닌 시각은 받지 않는다: %s", (iso) => {
    expect(() => toKstDate(iso)).toThrow(RangeError);
  });
});

describe("날짜 표기", () => {
  it("연도·요일 조합 네 가지", () => {
    expect(formatDate("2026-09-15")).toBe("2026년 9월 15일 화요일");
    expect(formatDate("2026-09-15", { weekday: false })).toBe("2026년 9월 15일");
    expect(formatDate("2026-09-15", { year: false })).toBe("9월 15일 화요일");
    expect(formatDate("2026-09-24", { year: false, weekday: false })).toBe("9월 24일");
  });

  it("요일은 그 날짜 기준이다", () => {
    expect(formatDate("2028-02-29")).toBe("2028년 2월 29일 화요일");
    expect(formatDate("2027-01-01")).toBe("2027년 1월 1일 금요일");
  });

  it("점 날짜와 연·월, 짧은 요일", () => {
    expect(formatDotDate("2026-09-15")).toBe("2026. 9. 15.");
    expect(formatYearMonth("2026-09-15")).toBe("2026년 9월");
    expect(formatWeekday("2026-09-15")).toBe("화");
    expect(`${formatDotDate("2026-09-15")}(${formatWeekday("2026-09-15")})`).toBe(
      "2026. 9. 15.(화)",
    );
  });

  it.each(["2026-02-30", "2026-13-01", "2026-9-15", "2026-09-15T00:00:00Z", "0020-01-01", ""])(
    "없는 날짜나 다른 형식은 받지 않는다: %s",
    (date) => {
      expect(() => formatDate(date)).toThrow(RangeError);
    },
  );
});

describe("시각 표기", () => {
  it("한국 시각 24시간제", () => {
    expect(formatTime("2026-09-15T09:04:00Z")).toBe("18:04");
    expect(formatTime("2026-09-14T15:00:00Z")).toBe("00:00");
    expect(formatTime("2026-09-15T01:24:00Z")).toBe("10:24");
  });

  it("날짜와 시각은 한국 날짜로 넘어간다", () => {
    expect(formatDateTime("2026-09-15T09:04:00Z")).toBe("9월 15일 18:04");
    expect(formatDateTime("2026-09-14T15:30:00Z")).toBe("9월 15일 00:30");
  });

  it.each([
    [0, "00:00"],
    [18, "00:18"],
    [18.9, "00:18"],
    [75, "01:15"],
    [4500, "75:00"],
  ])("formatMediaTime(%s) → %s", (seconds, expected) => {
    expect(formatMediaTime(seconds)).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "음수나 숫자가 아닌 값은 받지 않는다: %s",
    (s) => {
      expect(() => formatMediaTime(s)).toThrow(RangeError);
    },
  );
});

// 기기 시간대가 UTC보다 늦으면(미국 등) UTC 자정이 전날로 보여서 날짜가 하루 밀리는 버그가 드러납니다.
// 모듈을 다시 불러와 formatter도 그 시간대에서 새로 만듭니다.
describe.each(["Asia/Seoul", "America/Los_Angeles"])("기기 시간대가 %s여도 결과가 같다", (tz) => {
  const original = process.env.TZ;
  let datetime: typeof import("./datetime");

  beforeAll(async () => {
    process.env.TZ = tz;
    vi.resetModules();
    datetime = await import("./datetime");
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it("날짜와 시각 표기", () => {
    expect(datetime.formatDate("2026-09-15")).toBe("2026년 9월 15일 화요일");
    expect(datetime.formatDotDate("2026-09-15")).toBe("2026. 9. 15.");
    expect(datetime.formatWeekday("2026-09-15")).toBe("화");
    expect(datetime.toKstDate("2026-09-14T15:00:00Z")).toBe("2026-09-15");
    expect(datetime.formatTime("2026-09-15T09:04:00Z")).toBe("18:04");
  });
});
