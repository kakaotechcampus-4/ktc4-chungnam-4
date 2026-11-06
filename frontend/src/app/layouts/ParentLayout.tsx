import { Outlet } from "react-router";

import { ParentNav } from "./ParentNav";

// 학부모 화면(/p/*)의 틀입니다(Figma 1차 결과본 W3·W4). 상단바는 스크롤해도 따라오고, 뒤 내용이 비쳐 보입니다.
// 위쪽의 옅은 연두 빛은 장식입니다. 페이지는 제목 줄 PageHeader부터 시작합니다.
// 휴대폰에서 "웃었어/요"처럼 낱말 중간에서 줄이 바뀌지 않게 틀에서 낱말 단위 줄바꿈을 켭니다.
// 아래 여백이 큰 것은 휴대폰에서 화면 아래에 떠 있는 메뉴가 내용을 가리지 않게 하려는 것입니다.
export function ParentLayout() {
  return (
    <div className="relative isolate min-h-dvh wrap-break-word break-keep">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-linear-to-b from-leaf-soft/45 to-transparent"
      />
      <header className="sticky top-0 z-40 px-4 sm:px-6">
        {/* 유리 효과는 따로 깐 층에 줍니다. 메뉴를 감싸는 요소에 주면 휴대폰에서 화면 아래에 떠야 할 메뉴가
            그 요소를 기준으로 잡혀 상단바로 올라옵니다(backdrop-filter가 fixed의 기준이 됩니다). */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 border-b border-line/60 bg-canvas/70 backdrop-blur-xl"
        />
        <ParentNav />
      </header>
      <main className="mx-auto max-w-parent px-4 pb-28 sm:px-6 sm:pb-20">
        <Outlet />
      </main>
    </div>
  );
}
