import * as React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-[var(--cg-border)] bg-[var(--cg-bg)] px-3 py-2 text-sm text-[var(--cg-fg)]",
        "placeholder:text-[var(--cg-muted)]",
        "focus:outline-none focus:ring-1 focus:ring-[var(--cg-accent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export { Textarea };
