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
    <div
      className={[
        "flex flex-col shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
        "bg-[var(--cg-subtle)] border-r border-[var(--cg-border)]",
        collapsed ? "w-0" : "w-56",
      ].join(" ")}
    >
      {/* Toggle button — always rendered so it stays clickable */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--cg-border)]">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cg-muted)] whitespace-nowrap overflow-hidden">
          {collapsed ? "" : "Explorer"}
        </span>
        <button
          onClick={onToggle}
          className="text-[var(--cg-muted)] hover:text-[var(--cg-fg)] text-xs shrink-0 leading-none"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        {children}
      </div>
    </div>
  );
}
