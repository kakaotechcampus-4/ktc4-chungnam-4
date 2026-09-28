// TODO(이한나): #65 머지 후 @/components/common/FormField로 바꾸고 이 파일을 지웁니다.
import { type ComponentProps, useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps extends Omit<ComponentProps<typeof Input>, "id"> {
  label: string;
  /** 칸 아래에 보이는 오류 문구. 있으면 칸이 aria-invalid가 됩니다 */
  error?: string;
  /** 원안처럼 placeholder만 보이는 칸. 라벨은 화면 읽기 프로그램에만 남깁니다 */
  hideLabel?: boolean;
}

// 라벨 · 입력칸 · 오류 문구 한 벌입니다. react-hook-form의 register() 결과를 그대로 펼쳐 넣습니다.
export function FormField({
  label,
  error,
  hideLabel = false,
  className,
  ...inputProps
}: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  // 넘겨받은 안내 문구 id가 있으면 그 뒤에 오류 문구 id를 붙입니다. 하나로 덮어쓰면 오류가 읽히지 않습니다.
  const describedBy =
    [inputProps["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={cn("text-body text-ink", hideLabel && "sr-only")}>
        {label}
      </Label>
      <Input
        {...inputProps}
        id={id}
        aria-invalid={error ? true : inputProps["aria-invalid"]}
        aria-describedby={describedBy}
      />
      {/* 오류 문구 자리는 늘 두고 aria-live로 읽힙니다. 제출할 때 초점이 오류 칸으로 먼저 가고 문구가 뒤에 붙어서,
          칸 설명(aria-describedby)만으로는 화면 읽기 프로그램이 오류를 놓칩니다. 비어 있을 때는 자리를 차지하지 않습니다. */}
      <p
        id={errorId}
        aria-live="polite"
        className={
          error
            ? "text-label text-destructive motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200"
            : "sr-only"
        }
      >
        {error}
      </p>
    </div>
  );
}
