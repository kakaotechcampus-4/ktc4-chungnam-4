import { useState } from "react";

import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import type { LocalMedia } from "@/features/upload-queue/upload-queue-store";
import { cn } from "@/lib/utils";

import { objectUrlFor } from "./object-url";

interface LocalThumbnailProps {
  item: LocalMedia;
  className?: string;
}

// 업로드 큐의 사진을 이 탭 안에서만 보여 줍니다(object URL). 서버로 보내는 것이 아닙니다.
// 교사가 사진 속 아이를 확인하는 화면이라 가장자리가 잘리면 안 됩니다(잘린 곳의 아이를 놓칠 수 있음).
// 사진이 아니거나(영상·음성), 내용 없는 합성 파일이거나, 브라우저가 못 여는 형식(HEIC 등)이면 자리 표시를 씁니다.
export function LocalThumbnail({ item, className }: LocalThumbnailProps) {
  const [broken, setBroken] = useState(false);
  const url = item.kind === "photo" ? objectUrlFor(item.file) : null;

  if (!url || broken) {
    const kind = item.kind === "video" ? "영상" : item.kind === "voice_memo" ? "음성" : "사진";
    return <PhotoPlaceholder label={`${kind} ${item.file.name}`} className={className} />;
  }
  return (
    <img
      src={url}
      alt={item.file.name}
      onError={() => setBroken(true)}
      // 칸 비율과 달라도 자르지 않고 전체를 보여 줍니다. 남는 곳은 옅은 배경과 안쪽 여백으로 채웁니다.
      className={cn("bg-neutral-soft object-contain p-1", className)}
    />
  );
}
