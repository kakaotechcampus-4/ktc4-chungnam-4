import { ForbiddenPage } from "@/pages/forbidden/ForbiddenPage";

// 교사 내비 없이 보여 주는 접근 권한 없음입니다. 학부모가 교사 화면에 왔을 때처럼 내비를 보여 주면 안 될 때 씁니다.
// 폭과 여백은 교사 레이아웃과 같게 둡니다.
export function StandaloneForbidden() {
  return (
    <div className="px-6">
      <main className="mx-auto max-w-app">
        <ForbiddenPage />
      </main>
    </div>
  );
}
