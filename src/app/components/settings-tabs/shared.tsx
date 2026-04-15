import type { ReactNode } from "react";

// ── Shared field components ───────────────────────────────────────────────────

export interface SectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
}

/**
 * Titled group of related settings. Titles use a small uppercase eyebrow so they
 * read as scaffolding, not headings — the fields remain the primary content.
 */
export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="mb-6 last:mb-0">
      {title && (
        <div className="mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--cf-muted)]">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-xs text-[var(--cf-muted)]">{description}</p>
          )}
        </div>
      )}
      <div className="space-y-1">{children}</div>
    </section>
  );
}

export interface FieldProps {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
  /** Stack the control below the label instead of beside it — for wide controls. */
  stacked?: boolean;
}

/**
 * One setting row. Label + optional description on the left, control on the
 * right. `stacked` puts the control on its own line for textareas or grids.
 */
export function Field({ label, description, htmlFor, children, stacked }: FieldProps) {
  if (stacked) {
    return (
      <div className="py-3 first:pt-0 last:pb-0">
        <label
          htmlFor={htmlFor}
          className="block text-sm text-[var(--cf-fg)] cursor-pointer select-none"
        >
          {label}
        </label>
        {description && (
          <p className="mt-1 mb-2 text-xs text-[var(--cf-muted)]">{description}</p>
        )}
        {!description && <div className="mt-2" />}
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-6 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={htmlFor}
          className="block text-sm text-[var(--cf-fg)] cursor-pointer select-none"
        >
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-xs leading-snug text-[var(--cf-muted)]">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

