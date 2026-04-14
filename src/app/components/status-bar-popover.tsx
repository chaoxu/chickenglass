import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export interface StatusBarPopoverProps {
  readonly align: "left" | "right";
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly ariaLabel: string;
  readonly children: ReactNode;
  readonly minWidth: string;
  readonly onClose: () => void;
}

/**
 * Shared backdrop + positioning + Escape-dismiss wrapper for status-bar
 * popovers. Manual positioning is fine — the anchor is always at the
 * bottom of the viewport so there is no collision risk. @floating-ui was
 * evaluated and rejected: only 2 manual positioning sites exist, both trivial.
 */
export function StatusBarPopover({
  align,
  anchorRef,
  ariaLabel,
  children,
  minWidth,
  onClose,
}: StatusBarPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    if (align === "left") {
      panel.style.left = `${rect.left}px`;
    } else {
      panel.style.right = `${window.innerWidth - rect.right}px`;
    }
  }, [anchorRef, align]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="fixed z-50 rounded-md border border-[var(--cf-border)] bg-[var(--cf-bg)] p-3 text-xs text-[var(--cf-fg)]"
        style={{ minWidth }}
      >
        {children}
      </div>
    </>
  );
}
