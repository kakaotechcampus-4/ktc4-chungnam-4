import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// 값은 Figma 교사 화면 실측입니다. default는 현행 로그인 폼(높이 54),
// compact는 온보딩 폼 후보 A(높이 44)입니다. 어느 안으로 갈지는 팀이 정합니다.
const inputVariants = cva(
  "w-full min-w-0 rounded-md border-line bg-paper text-ink transition-[color,box-shadow] outline-none placeholder:text-ink-muted focus-visible:border-brand-ink focus-visible:ring-3 focus-visible:ring-brand-ink/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
  {
    variants: {
      inputSize: {
        default: "h-13.5 border-[1.5px] px-4 text-nav",
        compact: "h-11 border px-3.5 text-body",
      },
    },
    defaultVariants: {
      inputSize: "default",
    },
  },
);

function Input({
  className,
  type,
  inputSize,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ inputSize, className }))}
      {...props}
    />
  );
}

export { Input, inputVariants };
