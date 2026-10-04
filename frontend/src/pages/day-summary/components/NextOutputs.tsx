import { FileText } from "lucide-react";

const OUTPUTS = [
  { title: "관찰일지", detail: "격식체 · 누리과정 영역 태그" },
  { title: "알림장", detail: "학부모용 · 다정한 톤" },
];

// 오른쪽 아래 "다음에 만들 것"(Figma 1:3115). 전송하면 이 자료로 두 초안을 만듭니다.
export function NextOutputs() {
  return (
    <section
      aria-labelledby="outputs-title"
      className="flex flex-col gap-3 rounded-xl border border-line bg-neutral-soft p-5.5"
    >
      <h2 id="outputs-title" className="text-label font-bold text-ink">
        다음에 만들 것
      </h2>
      <ul className="flex flex-col gap-3">
        {OUTPUTS.map((output) => (
          <li
            key={output.title}
            className="flex gap-2.5 rounded-xl border border-line bg-paper px-3.5 py-3"
          >
            <FileText aria-hidden="true" className="mt-0.5 size-4 text-ink-muted" />
            <div className="flex flex-col gap-0.5 font-bold">
              <p className="text-label text-ink">{output.title}</p>
              <p className="text-caption text-ink-muted">{output.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-caption font-bold text-ink-muted">
        초안을 승인하기 전까지는 학부모에게 보이지 않습니다.
      </p>
    </section>
  );
}
