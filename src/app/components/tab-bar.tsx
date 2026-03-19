import { useRef, useState } from "react";
import type { Tab } from "../tab-bar";
import { cn } from "../lib/utils";

interface TabBarProps {
  tabs: Tab[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (tabs: Tab[]) => void;
}

/**
 * File tab bar with HTML5 drag-and-drop reordering.
 *
 * Design mirrors the vanilla tab-bar.ts: horizontal flex, border-bottom,
 * dot dirty indicator before the name, hover-only close button (×).
 */
export function TabBar({ tabs, activeTab, onSelect, onClose, onReorder }: TabBarProps) {
  /** Path of the tab currently being dragged, tracked as state so the
   *  dragging-opacity class re-renders correctly. */
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  /**
   * Drop index: the position in `tabs` where the dragged tab will be
   * inserted. `null` means no active drag-over.
   */
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Ref copy of draggingPath so drop handlers can read it without a stale
  // closure (drop fires after dragend in some browsers).
  const draggingPathRef = useRef<string | null>(null);

  // ── drag event handlers ──────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, path: string) {
    draggingPathRef.current = path;
    setDraggingPath(path);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", path);
  }

  function handleDragEnd() {
    draggingPathRef.current = null;
    setDraggingPath(null);
    setDropIndex(null);
  }

  /**
   * Compute the insertion index from the mouse X position relative to each
   * tab's midpoint, matching the vanilla implementation's logic exactly.
   * `bar` is the tab-bar container element (e.currentTarget on the bar).
   */
  function computeDropIndex(clientX: number, bar: HTMLElement): number {
    const tabEls = Array.from(bar.querySelectorAll<HTMLElement>("[data-tabindex]"));
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return tabEls.length;
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!draggingPathRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Guard: skip update when index hasn't changed (dragover fires continuously).
    const next = computeDropIndex(e.clientX, e.currentTarget);
    setDropIndex((prev) => (prev === next ? prev : next));
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only clear indicator when pointer leaves the entire bar.
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropIndex(null);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const srcPath = draggingPathRef.current;
    draggingPathRef.current = null;
    setDraggingPath(null);
    setDropIndex(null);

    if (!srcPath) return;

    const idx = computeDropIndex(e.clientX, e.currentTarget);
    const srcIndex = tabs.findIndex((t) => t.path === srcPath);
    if (srcIndex === -1) return;

    // Replicate the vanilla logic: remove then insert, adjusting for shrink.
    const next = [...tabs];
    const [srcTab] = next.splice(srcIndex, 1);
    const insertAt = srcIndex < idx ? idx - 1 : idx;
    next.splice(insertAt, 0, srcTab);
    onReorder(next);
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div
      data-tabbar
      className="flex flex-row items-stretch border-b border-[var(--cg-border)] bg-[var(--cg-bg-secondary)] relative overflow-x-auto overflow-y-hidden select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {tabs.map((tab, i) => {
        const isActive = tab.path === activeTab;
        const isDragging = tab.path === draggingPath;

        return (
          <div
            key={tab.path}
            data-tabindex={i}
            draggable
            onDragStart={(e) => { handleDragStart(e, tab.path); }}
            onDragEnd={handleDragEnd}
            onClick={() => { onSelect(tab.path); }}
            className={cn(
              "group relative flex items-center gap-1 px-3 h-8 text-sm cursor-pointer border-r border-[var(--cg-border)] shrink-0 whitespace-nowrap",
              "transition-[background-color,color] duration-[var(--cg-transition,0.15s)]",
              isActive
                ? "bg-[var(--cg-bg)] text-[var(--cg-fg)]"
                : "bg-[var(--cg-bg-secondary)] text-[var(--cg-muted)] hover:bg-[var(--cg-hover)]",
              isDragging && "opacity-40",
            )}
          >
            {/* Drop indicator line: shown to the LEFT of this tab */}
            {dropIndex === i && (
              <span className="absolute left-0 top-0 h-full w-0.5 bg-[var(--cg-accent)] pointer-events-none" />
            )}

            {/* Dirty dot before name */}
            {tab.dirty && (
              <span className="text-[var(--cg-muted)] leading-none">•</span>
            )}

            {/* File name */}
            <span className="max-w-[140px] truncate">{tab.name}</span>

            {/* Close button — visible only on hover */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.path);
              }}
              className="ml-1 flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--cg-transition,0.15s)] hover:bg-[var(--cg-hover)] text-[var(--cg-muted)] leading-none shrink-0"
              aria-label={`Close ${tab.name}`}
            >
              ×
            </button>
          </div>
        );
      })}

      {/* Spacer so the end-drop indicator has a relative parent at the right edge of the last tab */}
      {dropIndex === tabs.length && tabs.length > 0 && (
        <span className="relative shrink-0">
          <span className="absolute left-0 top-0 h-full w-0.5 bg-[var(--cg-accent)] pointer-events-none" />
        </span>
      )}
    </div>
  );
}
