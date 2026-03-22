import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<"input">>(
  function Input({ className, type = "text", ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-[var(--cg-border)] bg-[var(--cg-bg)] px-3 py-1 text-sm text-[var(--cg-fg)]",
          "placeholder:text-[var(--cg-muted)]",
          "focus:outline-none focus:ring-1 focus:ring-[var(--cg-accent)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

export { Input };
