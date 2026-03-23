import type { ReactNode } from "react";

// ── Shared field components ───────────────────────────────────────────────────

export interface RowProps {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}

export function Row({ label, htmlFor, children }: RowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--cf-border)] last:border-b-0">
      <label
        htmlFor={htmlFor}
        className="text-sm text-[var(--cf-fg)] cursor-pointer select-none"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
