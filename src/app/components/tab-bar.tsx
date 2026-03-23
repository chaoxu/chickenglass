import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState } from "react";

import type { Tab } from "../tab-bar";
import { cn } from "../lib/utils";

interface TabBarProps {
  tabs: Tab[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (tabs: Tab[]) => void;
  /** Double-click a tab to pin it (remove preview status). */
  onPin?: (path: string) => void;
}

/**
 * File tab bar with @dnd-kit sortable reordering.
 *
 * Uses @dnd-kit/core + @dnd-kit/sortable instead of manual HTML5 drag events.
 * This provides keyboard DnD (arrow keys), screen reader announcements, and
 * touch support out of the box.
 *
 * Design mirrors the vanilla tab-bar.ts: horizontal flex, border-bottom,
 * dot dirty indicator before the name, hover-only close button (x).
 */
export function TabBar({ tabs, activeTab, onSelect, onClose, onReorder, onPin }: TabBarProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 5px movement before starting drag to avoid interfering with
      // click-to-select. This matches the feel of the old HTML5 drag behavior.
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Unique IDs for SortableContext — must be stable string identifiers.
  const tabIds = tabs.map((t) => t.path);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tabs.findIndex((t) => t.path === active.id);
    const newIndex = tabs.findIndex((t) => t.path === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    onReorder(arrayMove(tabs, oldIndex, newIndex));
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  // Screen reader announcements for tab reordering.
  const announcements = {
    onDragStart({ active }: DragStartEvent) {
      const tab = tabs.find((t) => t.path === active.id);
      return `Picked up tab ${tab?.name ?? active.id}`;
    },
    onDragOver({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
      if (!over) return "";
      const activeTab = tabs.find((t) => t.path === active.id);
      const overTab = tabs.find((t) => t.path === over.id);
      return `Tab ${activeTab?.name ?? active.id} is over ${overTab?.name ?? over.id}`;
    },
    onDragEnd({ active, over }: DragEndEvent) {
      const tab = tabs.find((t) => t.path === active.id);
      if (over && active.id !== over.id) {
        const overTab = tabs.find((t) => t.path === over.id);
        return `Tab ${tab?.name ?? active.id} was moved next to ${overTab?.name ?? over.id}`;
      }
      return `Tab ${tab?.name ?? active.id} was dropped in its original position`;
    },
    onDragCancel({ active }: { active: { id: string | number } }) {
      const tab = tabs.find((t) => t.path === active.id);
      return `Dragging was cancelled. Tab ${tab?.name ?? active.id} was dropped`;
    },
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{ announcements }}
    >
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        <div
          data-tabbar
          className="flex flex-row items-stretch border-b border-[var(--cf-border)] bg-[var(--cf-bg-secondary)] relative overflow-x-auto overflow-y-hidden select-none overscroll-x-contain"
        >
          {tabs.map((tab) => (
            <SortableTab
              key={tab.path}
              tab={tab}
              isActive={tab.path === activeTab}
              isDragActive={tab.path === activeId}
              onSelect={onSelect}
              onClose={onClose}
              onPin={onPin}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// ── Sortable tab item ─────────────────────────────────────────────────────────

interface SortableTabProps {
  tab: Tab;
  isActive: boolean;
  isDragActive: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onPin?: (path: string) => void;
}

const SortableTab = memo(function SortableTab({ tab, isActive, isDragActive, onSelect, onClose, onPin }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.path });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => { onSelect(tab.path); }}
      onDoubleClick={() => { onPin?.(tab.path); }}
      className={cn(
        "group relative flex items-center gap-1 px-3 h-8 text-sm cursor-pointer border-r border-[var(--cf-border)] shrink-0 whitespace-nowrap",
        "transition-[background-color,color] duration-[var(--cf-transition,0.15s)]",
        isActive
          ? "bg-[var(--cf-bg)] text-[var(--cf-fg)]"
          : "bg-[var(--cf-bg-secondary)] text-[var(--cf-muted)] hover:bg-[var(--cf-hover)]",
        (isDragging || isDragActive) && "opacity-40",
      )}
    >
      {/* Dirty dot before name */}
      {tab.dirty && (
        <span className="text-[var(--cf-muted)] leading-none">&bull;</span>
      )}

      {/* File name — italic when preview tab */}
      <span className={cn("max-w-[140px] truncate", tab.preview && "italic")}>{tab.name}</span>

      {/* Close button -- visible only on hover, stops propagation to avoid
          triggering both close and select */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.path);
        }}
        className="ml-1 flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--cf-transition,0.15s)] hover:bg-[var(--cf-hover)] text-[var(--cf-muted)] leading-none shrink-0"
        aria-label={`Close ${tab.name}`}
      >
        &times;
      </button>
    </div>
  );
});
