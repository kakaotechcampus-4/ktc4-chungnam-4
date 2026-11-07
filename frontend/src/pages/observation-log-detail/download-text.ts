import type { ObservationRow } from "./observation-log-rows";

/** 영역 이름 다음 줄에 그 문장들을, 영역 사이는 빈 줄로 띄웁니다. 문장이 없는 영역은 이름만 남습니다. */
export function toPlainText(rows: readonly ObservationRow[]): string {
  return rows
    .map((row) => [row.section, ...row.sentences.map((sentence) => sentence.text)].join("\n"))
    .join("\n\n");
}

/** 임시 주소를 푸는 시간. `click()` 직후에 풀면 브라우저에 따라 다운로드가 끊길 수 있어 잠깐 둡니다. */
export const REVOKE_DELAY_MS = 1000;

/** 서버를 거치지 않고 브라우저에서 텍스트 파일로 저장합니다. 임시 주소는 쓰고 잠깐 뒤에 풉니다. */
export function downloadTextFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
