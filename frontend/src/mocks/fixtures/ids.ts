// 목 데이터의 공용 id입니다. 화면 사이 링크(대시보드 → 초안 검토 등)가 목에서도 이어지도록
// 모든 픽스처가 이 함수로 id를 만듭니다. 형식은 API 문서 v0 예시와 같습니다.
// 예: fixtureId("child", 1) → "c41d0000-0000-4000-8000-000000000001"
const PREFIX = {
  account: "ac000000",
  teacher: "7e000000",
  parent: "9a000000",
  center: "0c000000",
  class: "c1a50000",
  child: "c41d0000",
  clientPhoto: "1c000000",
  media: "3ed1a000",
  request: "4e000000",
  job: "10b00000",
  draft: "d7af0000",
} as const;

export function fixtureId(kind: keyof typeof PREFIX, n: number) {
  return `${PREFIX[kind]}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
