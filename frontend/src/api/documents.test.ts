import { QueryClient } from "@tanstack/react-query";

import { kstToday, shiftDate } from "@/lib/datetime";
import { fixtureId } from "@/mocks/fixtures/ids";

import { childDraftsQueryOptions } from "./documents";

// 기본 목 핸들러(mocks/handlers/documents.ts)가 자동으로 모였는지도 함께 확인합니다.
describe("documents 요청", () => {
  // 앱과 같이 캐시를 한동안 재사용하게 둡니다(app/query-client.ts는 staleTime 30초).
  // staleTime이 0이면 매번 서버에 다시 물어서 key가 겹쳐도 증상이 안 나옵니다.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  afterEach(() => queryClient.clear());

  const DOYUN = fixtureId("child", 1);
  const YESTERDAY = shiftDate(kstToday(), -1);

  // 게시 여부가 key에 없으면 "게시된 것만"과 "전부"가 같은 캐시를 씁니다. 그러면 미게시
  // 초안을 받아 온 화면(이한나 님 원아 개인 페이지 예정)을 본 뒤, 알림장 상세의 날짜
  // 목록에 아직 학부모에게 안 나간 초안이 섞입니다(H-1).
  it("전부 받는 요청을 먼저 해도 게시된 것만 받는 요청이 오염되지 않는다", async () => {
    const all = await queryClient.fetchQuery(childDraftsQueryOptions(DOYUN, "parent_note"));
    const published = await queryClient.fetchQuery(
      childDraftsQueryOptions(DOYUN, "parent_note", true),
    );

    // 시드에서 김도윤은 어제 초안이 미게시, 그제·사흘 전이 게시본입니다.
    expect(all.some((item) => item.record_date === YESTERDAY)).toBe(true);
    expect(published.some((item) => item.record_date === YESTERDAY)).toBe(false);
    expect(published.every((item) => item.published_at !== null)).toBe(true);
  });
});
