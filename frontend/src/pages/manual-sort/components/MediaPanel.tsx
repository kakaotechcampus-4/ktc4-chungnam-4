import { LocalThumbnail } from "@/features/classify/LocalThumbnail";
import type { LocalPhoto } from "@/features/upload-queue/upload-queue-store";
import { formatTime } from "@/lib/datetime";

interface MediaPanelProps {
  item: LocalPhoto;
}

// 촬영 시각은 EXIF를 읽기 전이라 파일 수정 시각으로 대신합니다(가정).
function describeItem(item: LocalPhoto) {
  return `${item.file.name} · ${formatTime(new Date(item.file.lastModified).toISOString())}`;
}

// 수동 분류·분류 바꾸기 왼쪽의 사진 패널입니다.
export function MediaPanel({ item }: MediaPanelProps) {
  return (
    <>
      <LocalThumbnail key={item.client_id} item={item} className="h-89.5 w-full rounded-xl" />
      <p className="text-body text-ink-muted">{describeItem(item)}</p>
      <p className="text-body text-ink-muted">
        {item.review_state === "확정" ? "연결했어요. 다시 고르면 바뀌어요." : null}
        {item.review_state === "제외" ? "제외한 사진이에요. 아이를 고르면 다시 포함돼요." : null}
        {item.review_state === "미검수" ? "여러 아이가 함께 나오면 모두 선택해 주세요." : null}
      </p>
    </>
  );
}
