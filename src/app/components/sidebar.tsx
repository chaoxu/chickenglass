import type { ReactNode } from "react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Collapsible sidebar container.
 * Transitions between w-56 (expanded) and w-0 (collapsed) with overflow-hidden
 * so child content is clipped cleanly without layout shift elsewhere.
 */
export function Sidebar({ collapsed, onToggle, children }: SidebarProps) {
  return (
    <div className="flex shrink-0">
      {/* Sidebar panel */}
      <div
        className={[
          "flex flex-col shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
          "bg-[var(--cg-subtle)] border-r border-[var(--cg-border)]",
          collapsed ? "w-0" : "w-56",
        ].join(" ")}
      >
        {/* Header with hover-only collapse button */}
        <div className="group shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--cg-border)]">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cg-muted)] whitespace-nowrap overflow-hidden">
            Explorer
          </span>
          <button
            onClick={onToggle}
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--cg-transition,0.15s)] text-[var(--cg-muted)] hover:text-[var(--cg-fg)] text-xs shrink-0 leading-none"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            ‹
          </button>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
          {children}
        </div>
      </div>

      {/* Expand button — outside the collapsed panel so it's always accessible */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="shrink-0 px-1 py-2 text-[var(--cg-muted)] hover:text-[var(--cg-fg)] hover:bg-[var(--cg-hover)] text-xs leading-none border-r border-[var(--cg-border)] transition-colors duration-150"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          ›
        </button>
      )}
    </div>
  );
}
