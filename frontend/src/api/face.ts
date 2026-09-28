import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type { FaceEmbedding } from "@/types/api-draft/face";

// 얼굴 임베딩 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
export const faceKeys = {
  embeddings: (classId: string) => ["classes", classId, "face-embeddings"] as const,
};

/**
 * 반 동의 원아의 기준 임베딩(온디바이스 분류용). 분류를 시작할 때 한 번 받고, 이번 배치 동안만 들고 있습니다.
 * 서버가 Cache-Control: no-store를 붙이므로 캐시에도 남기지 않습니다.
 */
export function faceEmbeddingsQueryOptions(classId: string) {
  return queryOptions({
    queryKey: faceKeys.embeddings(classId),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<FaceEmbedding>>(
          `/classes/${encodeURIComponent(classId)}/face-embeddings`,
          { signal },
        )
      ).items,
    gcTime: 0,
    staleTime: 0,
  });
}
