import { useEffect } from "react";

import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";

// 로컬 파일 미리보기 주소(object URL)를 파일마다 하나씩만 만들어 재사용합니다.
// 컴포넌트가 만들고 지우게 하면 개발 모드(StrictMode)가 효과를 두 번 돌리며 주소를 먼저 지워 이미지가 깨집니다.
// 주소는 이 탭 안에서만 쓰이고 서버로 가지 않습니다. 원본을 더 들고 있지 않을 때 releaseObjectUrl로 지웁니다.

const urls = new WeakMap<Blob, string>();

export function objectUrlFor(blob: Blob): string | null {
  // 테스트 환경(jsdom)처럼 object URL을 못 만드는 곳에서는 자리 표시를 쓰게 null을 줍니다.
  if (typeof URL.createObjectURL !== "function") return null;
  let url = urls.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(blob, url);
  }
  return url;
}

export function releaseObjectUrl(blob: Blob | null | undefined) {
  if (!blob) return;
  const url = urls.get(blob);
  if (url) URL.revokeObjectURL(url);
  urls.delete(blob);
}

// 업로드 큐에서 빠진 파일(처리 끝·취소로 큐를 비움)의 주소를 지웁니다. 큐를 비우는 쪽(처리 중 화면)이
// 미리보기 주소를 몰라도 되게 여기서 지켜봅니다.
useUploadQueue.subscribe((state, previous) => {
  if (state.items === previous.items) return;
  const kept = new Set(state.items.map((item) => item.file));
  for (const item of previous.items) if (!kept.has(item.file)) releaseObjectUrl(item.file);
});

const pendingRelease = new Map<Blob, ReturnType<typeof setTimeout>>();

/**
 * 업로드 큐 밖의 파일(얼굴 등록 사진 등) 미리보기를 화면에 있는 동안만 남깁니다.
 * 목록에서 빠지거나 화면을 떠나면 다음 틱에 주소를 지웁니다. 개발 모드(StrictMode)가 효과를 다시 돌리는 것은
 * 같은 틱 안이라 지우기를 취소하므로 이미지가 깨지지 않습니다.
 */
export function useReleaseObjectUrls(blobs: readonly (Blob | null)[]) {
  useEffect(() => {
    const kept = blobs.filter((blob): blob is Blob => blob !== null);
    for (const blob of kept) {
      clearTimeout(pendingRelease.get(blob));
      pendingRelease.delete(blob);
    }
    return () => {
      for (const blob of kept) {
        pendingRelease.set(
          blob,
          setTimeout(() => {
            pendingRelease.delete(blob);
            releaseObjectUrl(blob);
          }, 0),
        );
      }
    };
  }, [blobs]);
}
