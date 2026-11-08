import { type DateOnly, formatDotDate } from "@/lib/datetime";

// 생년월일 입력칸의 "YYYY. MM. DD." 문자열을 DateOnly로 바꿉니다. 0 채움과 끝의 점은 없어도 받습니다.
const DOT_DATE = /^(\d{4})\s*[.-]\s*(\d{1,2})\s*[.-]\s*(\d{1,2})\s*\.?$/;

/** 숫자열 앞에서 월·일 한 칸을 떼어 냅니다. 첫 자리가 maxFirst보다 크면 한 자리 값으로 보고 0을 채웁니다. */
function takeUnit(digits: string, maxFirst: string): [unit: string, rest: string] {
  if (digits === "") return ["", ""];
  if (digits[0] > maxFirst) return [`0${digits[0]}`, digits.slice(1)];
  return [digits.slice(0, 2), digits.slice(2)];
}

/**
 * 입력 중인 문자열에서 숫자만 뽑아 "YYYY. MM. DD." 모양으로 맞춥니다. 숫자 8자리만 쳐도 점이 들어갑니다.
 * 점은 다음 숫자가 올 때만 붙입니다. 지울 때 끝의 구분자가 되살아나 지워지지 않는 일을 막습니다.
 */
export function maskBirthDate(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  const year = digits.slice(0, 4);
  // 월은 첫 자리가 2 이상, 일은 4 이상이면 한 자리 값이므로 0을 채워 다음 숫자가 붙지 않게 합니다(4 → 04).
  const [month, afterMonth] = takeUnit(digits.slice(4), "1");
  const [day] = takeUnit(afterMonth, "3");
  let masked = year;
  if (month !== "") masked += `. ${month}`;
  if (day !== "") masked += `. ${day}`;
  return day.length === 2 ? `${masked}.` : masked;
}

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
