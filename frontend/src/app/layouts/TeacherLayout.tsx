import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router";

import { isTeacher, meQueryOptions } from "@/api/auth";
import { useCurrentClass } from "@/features/class-context/use-current-class";

import { TeacherNav } from "./TeacherNav";

// 교사 화면(/t/*)의 틀입니다. Figma 기준 화면은 1:1895(오늘의 기록 · 빈 상태)입니다.
// 헤더와 본문은 같은 1200 폭 안에 둡니다. 1440에서는 좌우 120이 되고, 넓거나 좁은 화면에서도 줄이 맞습니다.
// 구분선(1:1903)은 흐름 밖에 둡니다. Figma에서 선이 있는 화면과 없는 화면 모두 제목이 y=124에서 시작합니다.
export function TeacherLayout() {
  const { currentClass } = useCurrentClass();
  const klass = currentClass
    ? { centerName: currentClass.center_name, name: currentClass.name }
    : null;
  // 교사 이름은 /me에서 받습니다. 받기 전이거나 교사 계정이 아니면 비웁니다.
  // 로그인이 끊긴 경우는 가드가 처리하므로 여기서는 던지지 않고 이름만 비웁니다.
  const { data: me } = useQuery({ ...meQueryOptions(), throwOnError: false });
  const teacherName = isTeacher(me) ? me.name : null;

  return (
    <div className="px-6">
      <header className="relative mx-auto max-w-app">
        <TeacherNav klass={klass} teacherName={teacherName} />
        <div aria-hidden="true" className="absolute inset-x-0 top-full h-px bg-line" />
      </header>
      <main className="mx-auto max-w-app">
        <Outlet />
      </main>
    </div>
  );
}
