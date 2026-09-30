import { type DateOnly, formatDotDate } from "@/lib/datetime";

// 생년월일 입력칸의 "YYYY. MM. DD." 문자열을 DateOnly로 바꿉니다. 0 채움과 끝의 점은 없어도 받습니다.
const DOT_DATE = /^(\d{4})\s*[.-]\s*(\d{1,2})\s*[.-]\s*(\d{1,2})\s*\.?$/;

/** "2022. 03. 14." → "2022-03-14". 형식이 틀렸거나 2월 30일처럼 없는 날짜면 null */
export function parseBirthDate(input: string): DateOnly | null {
  const [, year, month, day] = DOT_DATE.exec(input.trim()) ?? [];
  if (year === undefined || month === undefined || day === undefined) return null;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  try {
    // 없는 날짜 검사는 lib/datetime에 맡깁니다(없는 날짜면 RangeError).
    formatDotDate(date);
    return date;
  } catch {
    return null;
  }
}
