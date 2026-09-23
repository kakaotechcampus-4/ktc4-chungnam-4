import { Outlet } from "react-router";

import { TeacherNav } from "./TeacherNav";

// TODO(송유진): /me와 /classes 목 API가 생기면 그 응답으로 바꿉니다. 지금은 Figma 예시 값입니다.
const PLACEHOLDER = { centerName: "햇살어린이집", klassName: "햇살반", teacherName: "김하늘" };

// 교사 화면(/t/*)의 틀입니다. Figma 기준 화면은 1:1895(오늘의 기록 · 빈 상태)입니다.
// 헤더와 본문은 같은 1200 폭 안에 둡니다. 1440에서는 좌우 120이 되고, 넓거나 좁은 화면에서도 줄이 맞습니다.
// 구분선(1:1903)은 흐름 밖에 둡니다. Figma에서 선이 있는 화면과 없는 화면 모두 제목이 y=124에서 시작합니다.
export function TeacherLayout() {
  return (
    <div className="px-6">
      <header className="relative mx-auto max-w-app">
        <TeacherNav {...PLACEHOLDER} />
        <div aria-hidden="true" className="absolute inset-x-0 top-full h-px bg-line" />
      </header>
      <main className="mx-auto max-w-app">
        <Outlet />
      </main>
    </div>
  );
}
