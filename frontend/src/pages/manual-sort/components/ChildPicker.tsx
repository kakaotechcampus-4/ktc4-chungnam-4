import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SAMPLE_CHILDREN } from "@/features/classify/sample-data";

interface ChildPickerProps {
  title: string;
  initialSelected: readonly string[];
  onConnect: () => void;
}

// 수동 분류 오른쪽의 아이 귀속 패널입니다. 여러 아이를 고를 수 있습니다.
export function ChildPicker({ title, initialSelected, onConnect }: ChildPickerProps) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initialSelected));
  const visible = SAMPLE_CHILDREN.filter((child) => child.name.includes(query.trim()));

  function toggle(childId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(childId);
      else next.delete(childId);
      return next;
    });
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex h-132.5 w-103 shrink-0 flex-col gap-5 rounded-2xl bg-paper p-7"
    >
      <h2 id={titleId} className="text-xl font-bold text-ink">
        {title}
      </h2>
      <Input
        inputSize="compact"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="이름으로 검색"
        aria-label="이름으로 검색"
      />
      <ul className="flex flex-col gap-1 overflow-y-auto text-lg text-ink">
        {visible.map((child) => (
          <li key={child.id}>
            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                checked={selected.has(child.id)}
                onCheckedChange={(value) => toggle(child.id, value === true)}
              />
              {child.name}
            </label>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="text-body text-ink-muted">‘{query.trim()}’와 일치하는 아이가 없어요.</li>
        ) : null}
      </ul>
      <p className="text-label text-ink-muted">선택 {selected.size}명 · 여러 아이 선택 가능</p>
      <Button className="mt-auto w-full" disabled={selected.size === 0} onClick={onConnect}>
        선택한 아이에게 연결
      </Button>
    </section>
  );
}
