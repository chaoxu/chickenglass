import { type ReactNode, useRef, useCallback, useEffect } from "react";
import { PanelLeft } from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}

const MIN_WIDTH = 140;
const MAX_WIDTH = 480;

/**
 * Collapsible sidebar with drag-to-resize.
 *
 * The right edge is a 4px drag handle. Dragging adjusts the width
 * between MIN_WIDTH and MAX_WIDTH. Double-clicking the handle resets
 * to the default width (224px).
 */
export function Sidebar({ collapsed, onToggle, width, onWidthChange, children }: SidebarProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      onWidthChange(newWidth);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onWidthChange]);

  const onDoubleClick = useCallback(() => {
    onWidthChange(224); // reset to default w-56
  }, [onWidthChange]);

  return (
    <div className="flex shrink-0">
      {/* Sidebar panel */}
      <div
        className={[
          "flex flex-col shrink-0 overflow-hidden",
          "bg-[var(--cg-subtle)] border-r border-[var(--cg-border)]",
          collapsed ? "w-0" : "",
          // Only animate width when not dragging
          dragging.current ? "" : "transition-[width] duration-[var(--cg-transition,0.15s)] ease-in-out",
        ]
          .filter(Boolean)
          .join(" ")}
        style={collapsed ? undefined : { width: `${width}px` }}
      >
        {/* Header with always-visible collapse button */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--cg-border)]">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cg-muted)] whitespace-nowrap overflow-hidden">
            Explorer
          </span>
          <button
            onClick={onToggle}
            className="flex items-center justify-center w-7 h-7 rounded text-[var(--cg-muted)] hover:text-[var(--cg-fg)] hover:bg-[var(--cg-hover)] transition-colors duration-[var(--cg-transition,0.15s)] shrink-0"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeft size={16} />
          </button>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
          {children}
        </div>
      </div>

      {/* Invisible drag handle — overlaps the border edge for easy grabbing */}
      {!collapsed && (
        <div
          className="shrink-0 w-1 cursor-col-resize relative -ml-[2px] z-10 hover:bg-[var(--cg-active)] active:bg-[var(--cg-active)] transition-colors duration-[var(--cg-transition,0.15s)]"
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
        />
      )}

      {/* Expand button — always visible outside the collapsed panel */}
      {collapsed && (
        <div className="shrink-0 flex flex-col border-r border-[var(--cg-border)]">
          <div className="px-1 py-2">
            <button
              onClick={onToggle}
              className="flex items-center justify-center w-7 h-7 rounded text-[var(--cg-muted)] hover:text-[var(--cg-fg)] hover:bg-[var(--cg-hover)] transition-colors duration-[var(--cg-transition,0.15s)]"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeft size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
