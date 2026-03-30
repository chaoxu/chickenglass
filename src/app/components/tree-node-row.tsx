import type { ReactNode, MouseEvent as ReactMouseEvent, KeyboardEvent } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import type { MenuItem } from "../hooks/use-tree-node-row";

interface TreeNodeRowProps {
  /** Props from headless-tree (data-testid, role, etc.) */
  rowProps: Record<string, unknown>;
  /** Merged ref that combines local and headless-tree refs */
  mergedRef: (el: HTMLDivElement | null) => void;
  /** Horizontal indentation in pixels */
  indent: number;
  /** Whether this node is the active selection */
  isActive: boolean;
  /** Whether this node is focused */
  isFocused: boolean;
  /** Icon element to render (e.g., FileIcon or FolderIcon) */
  icon: ReactNode;
  /** Content inside the row after the icon (label, rename editor, etc.) */
  children: ReactNode;
  /** Menu items for context menu */
  menuItems: MenuItem[];
  /** Click handler for the row */
  onRowClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Context menu handler */
  onContextSelection: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Keyboard handler for the row */
  onRowKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** Optional double-click handler */
  onDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export function TreeNodeRow({
  rowProps,
  mergedRef,
  indent,
  isActive,
  isFocused,
  icon,
  children,
  menuItems,
  onRowClick,
  onContextSelection,
  onRowKeyDown,
  onDoubleClick,
}: TreeNodeRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...rowProps}
          ref={mergedRef}
          className={[
            "flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm text-[var(--cf-fg)] select-none whitespace-nowrap",
            isActive || isFocused ? "bg-[var(--cf-active)]" : "hover:bg-[var(--cf-hover)]",
          ].join(" ")}
          style={{ paddingLeft: `${indent}px` }}
          onClick={onRowClick}
          onContextMenu={onContextSelection}
          onKeyDown={onRowKeyDown}
          onDoubleClick={onDoubleClick}
        >
          {icon}
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[160px]">
        {menuItems.map((menuItem, index) =>
          menuItem.label === "-" ? (
            <ContextMenuSeparator key={index} />
          ) : (
            <ContextMenuItem key={index} onSelect={() => menuItem.action?.()}>
              {menuItem.label}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
