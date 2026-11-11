import { type ImgHTMLAttributes, useState } from "react";

import { cn } from "@/lib/utils";

// 사진을 다 받으면 서서히 나타납니다. 서명 URL은 받을 때마다 달라 캐시를 못 타서, 갑자기 뜨는 느낌을 줄입니다.
// 같은 전환에 호버 확대도 함께 태웁니다. 바깥에서 group-hover:scale-105를 넘기면 부드럽게 커집니다.
export function FadeImage({
  className,
  alt = "",
  onLoad,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      {...props}
      alt={alt}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      className={cn(
        "motion-safe:transition motion-safe:duration-700 motion-safe:ease-soft",
        !loaded && "motion-safe:opacity-0",
        className,
      )}
    />
  );
}
