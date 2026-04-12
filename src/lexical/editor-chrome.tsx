import * as React from "react";

import { cn } from "../lib/utils";

export function EditorChromePanel({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-sm border border-[color:var(--cf-border-overlay,var(--cf-border))] bg-[var(--cf-bg)] text-[var(--cf-fg)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EditorChromeBody({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("px-2 py-1.5", className)}>
      {children}
    </div>
  );
}

export const EditorChromeInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(function EditorChromeInput({ className, type = "text", ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-8 w-full rounded-sm border border-transparent bg-[color:color-mix(in_srgb,var(--cf-bg)_94%,var(--cf-hover))] px-2 py-1",
        "text-sm text-[var(--cf-fg)] placeholder:text-[var(--cf-muted)]",
        "focus:outline-none focus:border-[var(--cf-border)] focus:bg-[var(--cf-bg)] focus:ring-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
