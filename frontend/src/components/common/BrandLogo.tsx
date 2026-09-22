import { Link } from "react-router";

import logoHorizontal from "@/assets/brand/logo-horizontal.svg";

interface BrandLogoProps {
  /** 로고를 눌렀을 때 갈 곳 */
  to: string;
}

// 헤더 왼쪽의 가로형 로고(127×40)입니다. 심볼과 워드마크가 한 파일이라 글꼴이 필요 없습니다.
export function BrandLogo({ to }: BrandLogoProps) {
  return (
    <Link
      to={to}
      className="shrink-0 rounded-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <img src={logoHorizontal} alt="아이담" className="h-10 w-auto" />
    </Link>
  );
}
