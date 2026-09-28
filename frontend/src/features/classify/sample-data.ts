// 목 API가 붙기 전까지 ④ 얼굴 분류 · 수동 분류 · 하루 정리 · 얼굴 정보 화면이 함께 쓰는 예시 값입니다.
// 값은 Figma 추출본(Untitled 섹션 2:3038)의 문구 그대로이고, 이름은 모두 합성입니다.
// TODO(김동건): api-client·목 도구(#48~#50)가 머지되면 mocks/fixtures로 옮기고 useQuery로 바꿉니다.
//               원아 id는 #50의 fixtureId("child", n)과 같은 값이라 그대로 이어집니다.

export interface SampleChild {
  id: string;
  name: string;
  /** 문장 속 호칭. 예: "오늘 도윤이는 이랬어요" */
  nickname: string;
}

// 튜플로 두어 SAMPLE_CHILDREN[0]처럼 꺼낼 때 undefined 검사가 필요 없게 합니다.
export const SAMPLE_CHILDREN = [
  { id: "c41d0000-0000-4000-8000-000000000001", name: "김도윤", nickname: "도윤이" },
  { id: "c41d0000-0000-4000-8000-000000000002", name: "이하준", nickname: "하준이" },
  { id: "c41d0000-0000-4000-8000-000000000003", name: "박서아", nickname: "서아" },
  { id: "c41d0000-0000-4000-8000-000000000004", name: "최지우", nickname: "지우" },
  { id: "c41d0000-0000-4000-8000-000000000005", name: "정예린", nickname: "예린이" },
] as const satisfies readonly SampleChild[];

export function findSampleChild(childId: string | undefined): SampleChild | undefined {
  return SAMPLE_CHILDREN.find((child) => child.id === childId);
}

export const SAMPLE_DATE_LABEL = "2026년 9월 15일";
