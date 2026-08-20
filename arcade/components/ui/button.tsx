import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] border text-sm font-semibold transition-[transform,background-color,border-color,opacity,box-shadow] duration-160 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--accent)] text-white shadow-[rgba(0,0,0,0.2)_0_1px_2px,rgba(255,255,255,0.25)_0_1px_0.5px_inset,rgba(79,71,235,0.9)_0_0_0_1px] hover:opacity-90",
        secondary:
          "border-[var(--line)] bg-[var(--panel)] text-[var(--text)] hover:border-[var(--scope)] hover:bg-[rgba(110,84,255,0.12)]",
        outline:
          "border-[var(--line)] bg-transparent text-[var(--text)] hover:border-[var(--scope)] hover:bg-[rgba(110,84,255,0.1)]",
        ghost: "border-transparent bg-transparent text-[var(--dim)] hover:bg-[rgba(110,84,255,0.1)] hover:text-[var(--text)]",
        destructive: "border-[var(--danger)] bg-transparent text-[var(--danger)] hover:bg-[rgba(200,58,74,0.08)]",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 rounded-[8px] px-3.5 text-[13px]",
        lg: "h-12 px-7 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
