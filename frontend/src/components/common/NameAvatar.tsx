import { cn } from "@/lib/utils";

interface NameAvatarProps {
  name: string;
  className?: string;
}

// 이름 첫 글자를 담은 동그라미입니다. 옆에 이름이 함께 보이므로 읽어 주지 않습니다.
export function NameAvatar({ name, className }: NameAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-label font-bold text-brand-ink",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}
