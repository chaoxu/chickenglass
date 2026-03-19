import type { ReactNode } from "react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Panel-left icon (sidebar with left panel highlighted). */
function PanelLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

/**
 * Collapsible sidebar container.
 *
 * Copies ChatGPT-style toggle: an always-visible icon button at the top of the
 * sidebar header. When collapsed, the same button appears outside the panel
 * so it's always discoverable — no hover required.
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
        {/* Header with always-visible collapse button */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--cg-border)]">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cg-muted)] whitespace-nowrap overflow-hidden">
            Explorer
          </span>
          <button
            onClick={onToggle}
            className="flex items-center justify-center w-7 h-7 rounded text-[var(--cg-muted)] hover:text-[var(--cg-fg)] hover:bg-[var(--cg-hover)] transition-colors duration-150 shrink-0"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftIcon />
          </button>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
          {children}
        </div>
      </div>

      {/* Expand button — always visible outside the collapsed panel */}
      {collapsed && (
        <div className="shrink-0 flex flex-col border-r border-[var(--cg-border)]">
          <div className="px-1 py-2">
            <button
              onClick={onToggle}
              className="flex items-center justify-center w-7 h-7 rounded text-[var(--cg-muted)] hover:text-[var(--cg-fg)] hover:bg-[var(--cg-hover)] transition-colors duration-150"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeftIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
