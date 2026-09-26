// 날짜·시각 변환과 표기는 이 파일에서만 합니다(frontend/CLAUDE.md §데이터).
// 서버는 시각을 UTC ISO 8601("2026-09-15T09:04:00Z")로, 날짜만 있는 값은 한국 날짜 "YYYY-MM-DD"로 줍니다.
// 표기는 Figma 화면에서 두 명 이상이 쓰는 형식만 뒀습니다. Figma에 섞인 형식은 많이 쓰인 쪽으로 정했습니다
// (시각은 24시간제, 점 날짜는 0을 채우지 않음). 한 화면에서만 쓰는 형식은 이 파일 함수의 결과를 이어 붙여
// 만들고, 화면에서 Intl이나 Date로 직접 만들지 않습니다. 예: `${formatDotDate(d)}(${formatWeekday(d)})`

/** 한국 날짜. 예: "2026-09-15" */
export type DateOnly = string;

const KST = "Asia/Seoul";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// 형식 전체를 먼저 봅니다. 벗어난 문자열은 브라우저마다 다르게 읽습니다("2026-09-15Z"를 Chrome은 받고 Safari는 거부).
// 시간대가 없는 "2026-09-15T09:04:00"도 기기 시간대로 읽혀서 받지 않습니다.
const ISO_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone, ...options });
}

// DateOnly는 UTC 자정으로 만들어 UTC로 표기합니다. 기기 시간대와 상관없이 같은 날짜가 나옵니다.
const DATE_FORMATS = {
  full: formatter("UTC", { dateStyle: "full" }), // 2026년 9월 15일 화요일
  long: formatter("UTC", { dateStyle: "long" }), // 2026년 9월 15일
  monthDayWeekday: formatter("UTC", { month: "long", day: "numeric", weekday: "long" }), // 9월 15일 화요일
  monthDay: formatter("UTC", { month: "long", day: "numeric" }), // 9월 15일
  dot: formatter("UTC", { dateStyle: "medium" }), // 2026. 9. 15.
  yearMonth: formatter("UTC", { year: "numeric", month: "long" }), // 2026년 9월
  weekday: formatter("UTC", { weekday: "short" }), // 화
};
const TIME_FORMATS = {
  time: formatter(KST, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), // 18:04
  dateTime: formatter(KST, {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }), // 9월 15일 18:04
};
const KST_DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: KST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseDateOnly(date: DateOnly): Date {
  const [, year, month, day] = DATE_ONLY.exec(date) ?? [];
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // 형식이 틀렸거나 2026-02-30처럼 없는 날짜면 다른 날로 넘어가므로 거릅니다.
  // Date.UTC는 0~99년을 1900년대로 바꾸므로 연도도 비교합니다.
  if (
    value.getUTCFullYear() !== Number(year) ||
    value.getUTCMonth() !== Number(month) - 1 ||
    value.getUTCDate() !== Number(day)
  ) {
    throw new RangeError(`YYYY-MM-DD 날짜가 아닙니다: ${date}`);
  }
  return value;
}

function parseDateTime(isoDateTime: string): Date {
  const [, datePart] = ISO_DATE_TIME.exec(isoDateTime) ?? [];
  const value = new Date(isoDateTime);
  if (datePart === undefined || Number.isNaN(value.getTime())) {
    throw new RangeError(`시간대가 있는 ISO 8601 시각이 아닙니다: ${isoDateTime}`);
  }
  // "2026-02-30T09:04:00Z"를 Chrome은 3월 2일로 넘겨 받으므로 날짜 부분도 검사합니다.
  parseDateOnly(datePart);
  return value;
}

function toKstDateOnly(instant: Date): DateOnly {
  const parts = Object.fromEntries(
    KST_DATE_PARTS.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 지금의 한국 날짜. 테스트에서는 now를 넘깁니다. */
export function kstToday(now: Date = new Date()): DateOnly {
  return toKstDateOnly(now);
}

/** UTC 시각이 한국 날짜로 며칠인지. "2026-09-14T15:00:00Z" → "2026-09-15" */
export function toKstDate(isoDateTime: string): DateOnly {
  return toKstDateOnly(parseDateTime(isoDateTime));
}

interface FormatDateOptions {
  /** 연도를 붙입니다. 기본 true */
  year?: boolean;
  /** 요일을 붙입니다. 기본 true */
  weekday?: boolean;
}

/** "2026년 9월 15일 화요일". 옵션으로 연도·요일을 뺍니다: "9월 15일 화요일", "2026년 9월 15일", "9월 15일" */
export function formatDate(
  date: DateOnly,
  { year = true, weekday = true }: FormatDateOptions = {},
) {
  const value = parseDateOnly(date);
  if (year) return (weekday ? DATE_FORMATS.full : DATE_FORMATS.long).format(value);
  return (weekday ? DATE_FORMATS.monthDayWeekday : DATE_FORMATS.monthDay).format(value);
}

/** "2026. 9. 15." 목록·표의 짧은 날짜 */
export function formatDotDate(date: DateOnly) {
  return DATE_FORMATS.dot.format(parseDateOnly(date));
}

/** "2026년 9월" */
export function formatYearMonth(date: DateOnly) {
  return DATE_FORMATS.yearMonth.format(parseDateOnly(date));
}

/** 짧은 요일 "화". 한 화면에서만 쓰는 형식을 이어 붙여 만들 때 씁니다. */
export function formatWeekday(date: DateOnly) {
  return DATE_FORMATS.weekday.format(parseDateOnly(date));
}

/** 한국 시각 "18:04"(24시간제) */
export function formatTime(isoDateTime: string) {
  return TIME_FORMATS.time.format(parseDateTime(isoDateTime));
}

/** 한국 날짜와 시각 "9월 15일 18:04". 알림장 게시 일시 등 */
export function formatDateTime(isoDateTime: string) {
  return TIME_FORMATS.dateTime.format(parseDateTime(isoDateTime));
}

/** 영상·음성 길이나 재생 위치 "00:18". 한 시간이 넘으면 분이 60을 넘습니다("75:00"). */
export function formatMediaTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new RangeError(`0 이상의 초가 아닙니다: ${totalSeconds}`);
  }
  const seconds = Math.floor(totalSeconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}
