import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

// 값은 Figma 교사 화면 실측입니다. variant 이름은 shadcn 생성물이 참조하므로 그대로 둡니다.
// default 연두(#eff4e5) · secondary 연한 연두(#f2f5ea) · outline 흰 바탕 · solid 진녹(#36533f, 후보 A)
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-bold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-brand-border bg-primary text-primary-foreground hover:bg-tint-2",
        secondary: "bg-tint-2 text-ink hover:bg-neutral-soft",
        outline: "border-line bg-paper text-ink hover:bg-tint-2",
        solid: "bg-brand-ink text-paper hover:bg-brand-ink/90",
        ghost: "text-ink hover:bg-tint-2",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "text-brand-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11.5 gap-2 px-5.5",
        sm: "h-10 gap-1.5 px-4",
        lg: "h-12 gap-2 px-5.5",
        block: "h-13.5 w-full gap-2 px-5.5 text-base",
        icon: "size-11.5",
        "icon-sm": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
