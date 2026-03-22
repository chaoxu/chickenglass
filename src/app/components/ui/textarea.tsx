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
        "flex min-h-[80px] w-full rounded-md border border-[var(--cf-border)] bg-[var(--cf-bg)] px-3 py-2 text-sm text-[var(--cf-fg)]",
        "placeholder:text-[var(--cf-muted)]",
        "focus:outline-none focus:ring-1 focus:ring-[var(--cf-accent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export { Textarea };
