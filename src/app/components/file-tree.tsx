import { useState, useRef, useCallback, useEffect } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { FileEntry } from "../file-manager";
import { isTauri, revealInFinder } from "../tauri-fs";
import {
  File,
  FileText,
  FileCode,
  FileJson,
  BookOpen,
  Settings,
  FolderClosed,
  FolderOpen,
} from "lucide-react";

const ICON_SIZE = 14;
const ICON_CLASS = "shrink-0 text-[var(--cg-muted)]";

/** Map file extension to an icon component. */
function FileIcon({ name }: { name: string }) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (ext) {
    case "md":
    case "mdx":
    case "txt":
      return <FileText size={ICON_SIZE} className={ICON_CLASS} />;
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "py":
    case "go":
    case "css":
    case "html":
      return <FileCode size={ICON_SIZE} className={ICON_CLASS} />;
    case "json":
      return <FileJson size={ICON_SIZE} className={ICON_CLASS} />;
    case "bib":
      return <BookOpen size={ICON_SIZE} className={ICON_CLASS} />;
    case "yaml":
    case "yml":
    case "toml":
    case "csl":
      return <Settings size={ICON_SIZE} className={ICON_CLASS} />;
    default:
      return <File size={ICON_SIZE} className={ICON_CLASS} />;
  }
}

interface FileTreeProps {
  root: FileEntry | null;
  activePath: string | null;
  onSelect: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  activePath: string | null;
  onSelect: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
}

function FileNode({
  entry,
  depth,
  activePath,
  onSelect,
  onRename,
  onDelete,
  onCreateFile,
  onCreateDir,
}: FileNodeProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const indent = depth * 12 + 8;
  const isActive = entry.path === activePath;

  // ── Rename ────────────────────────────────────────────────────────────────

  const startRename = useCallback(() => {
    setRenameValue(entry.name);
    setRenaming(true);
    setContextMenu(null);
    // Focus after state flushes
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [entry.name]);

  const commitRename = useCallback(async () => {
    const newName = renameValue.trim();
    setRenaming(false);
    if (!newName || newName === entry.name) return;
    const dir = entry.path.includes("/")
      ? entry.path.substring(0, entry.path.lastIndexOf("/") + 1)
      : "";
    await onRename(entry.path, dir + newName);
  }, [renameValue, entry.name, entry.path, onRename]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  const handleRenameKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelRename();
      }
    },
    [commitRename, cancelRename],
  );

  const handleItemKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "F2") {
        e.preventDefault();
        startRename();
      }
    },
    [startRename],
  );

  // ── Context menu ─────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, [entry]);

  const dismissMenu = useCallback(() => setContextMenu(null), []);

  const parentPath = entry.path.includes("/")
    ? entry.path.substring(0, entry.path.lastIndexOf("/"))
    : "";

  // ── Shared menu items ──────────────────────────────────────────────────

  const revealItem: MenuItem | null = isTauri()
    ? {
        label: "Reveal in Finder",
        action: () => void revealInFinder(entry.path),
      }
    : null;

  // ── Directory rendering ───────────────────────────────────────────────────

  if (entry.isDirectory) {
    const dirMenuItems: MenuItem[] = [
      {
        label: "New File",
        action: () => {
          const name = window.prompt("File name:");
          if (name?.trim()) onCreateFile(`${entry.path}/${name.trim()}`);
        },
      },
      {
        label: "New Folder",
        action: () => {
          const name = window.prompt("Folder name:");
          if (name?.trim()) onCreateDir(`${entry.path}/${name.trim()}`);
        },
      },
      { label: "-" },
      { label: "Rename", action: startRename },
      {
        label: "Delete",
        action: () => void onDelete(entry.path),
      },
    ];

    if (revealItem) {
      dirMenuItems.push({ label: "-" }, revealItem);
    }

    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          className="flex items-center gap-1 px-2 py-[2px] cursor-pointer hover:bg-[var(--cg-hover)] text-sm text-[var(--cg-fg)] select-none whitespace-nowrap"
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => setOpen((o) => !o)}
          onContextMenu={handleContextMenu}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
            if (e.key === "F2") {
              e.preventDefault();
              startRename();
            }
          }}
        >
          {open
            ? <FolderOpen size={ICON_SIZE} className={ICON_CLASS} />
            : <FolderClosed size={ICON_SIZE} className={ICON_CLASS} />
          }

          {renaming ? (
            <input
              ref={renameInputRef}
              type="text"
              className="flex-1 text-sm font-mono bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded px-1 outline-none min-w-0"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKey}
              onBlur={cancelRename}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="font-mono truncate">{entry.name}</span>
          )}
        </div>

        {open && entry.children && (
          <div>
            {entry.children.map((child) => (
              <FileNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                activePath={activePath}
                onSelect={onSelect}
                onRename={onRename}
                onDelete={onDelete}
                onCreateFile={onCreateFile}
                onCreateDir={onCreateDir}
              />
            ))}
          </div>
        )}

        {/* Directory context menu */}
        {contextMenu && (
          <ContextMenuPortal
            x={contextMenu.x}
            y={contextMenu.y}
            onDismiss={dismissMenu}
            items={dirMenuItems}
          />
        )}
      </div>
    );
  }

  // ── File rendering ────────────────────────────────────────────────────────

  const fileMenuItems: MenuItem[] = [
    { label: "Open", action: () => onSelect(entry.path) },
    { label: "-" },
    { label: "Rename", action: startRename },
    {
      label: "Delete",
      action: () => void onDelete(entry.path),
    },
    { label: "-" },
    {
      label: "New File",
      action: () => {
        const name = window.prompt("File name:");
        if (name?.trim()) {
          onCreateFile(parentPath ? `${parentPath}/${name.trim()}` : name.trim());
        }
      },
    },
    {
      label: "New Folder",
      action: () => {
        const name = window.prompt("Folder name:");
        if (name?.trim()) {
          onCreateDir(parentPath ? `${parentPath}/${name.trim()}` : name.trim());
        }
      },
    },
  ];

  if (revealItem) {
    fileMenuItems.push({ label: "-" }, revealItem);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        "flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm text-[var(--cg-fg)] select-none whitespace-nowrap",
        isActive
          ? "bg-[var(--cg-active)]"
          : "hover:bg-[var(--cg-hover)]",
      ].join(" ")}
      style={{ paddingLeft: `${indent}px` }}
      onClick={() => onSelect(entry.path)}
      onContextMenu={handleContextMenu}
      onKeyDown={handleItemKey}
    >
      <FileIcon name={entry.name} />

      {renaming ? (
        <input
          ref={renameInputRef}
          type="text"
          className="flex-1 text-sm font-mono bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded px-1 outline-none min-w-0"
          value={renameValue}
          autoFocus
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleRenameKey}
          onBlur={cancelRename}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="font-mono truncate">{entry.name}</span>
      )}

      {/* File context menu */}
      {contextMenu && (
        <ContextMenuPortal
          x={contextMenu.x}
          y={contextMenu.y}
          onDismiss={dismissMenu}
          items={fileMenuItems}
        />
      )}
    </div>
  );
}

// ── Context menu with keyboard navigation ──────────────────────────────

interface MenuItem {
  label: string;
  action?: () => void;
}

interface ContextMenuPortalProps {
  x: number;
  y: number;
  items: MenuItem[];
  onDismiss: () => void;
}

function ContextMenuPortal({ x, y, items, onDismiss }: ContextMenuPortalProps) {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionItems = items.filter((item) => item.label !== "-");

  // Focus the menu container on mount for keyboard navigation
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const handleMenuKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev + 1;
          return next >= actionItems.length ? 0 : next;
        });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? actionItems.length - 1 : next;
        });
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < actionItems.length) {
          onDismiss();
          actionItems[focusedIndex].action?.();
        }
        return;
      }
    },
    [onDismiss, focusedIndex, actionItems],
  );

  // Map from the full items array index to the action-item index
  let actionIdx = -1;

  return (
    <>
      {/* Click-away backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onDismiss}
        onContextMenu={(e) => {
          e.preventDefault();
          onDismiss();
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        tabIndex={0}
        className="fixed z-50 min-w-[160px] py-1 bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded shadow-sm text-sm text-[var(--cg-fg)] outline-none"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleMenuKey}
      >
        {items.map((item, i) => {
          if (item.label === "-") {
            return (
              <div key={i} className="my-1 border-t border-[var(--cg-border)]" />
            );
          }

          actionIdx++;
          const isFocused = actionIdx === focusedIndex;

          return (
            <button
              key={i}
              role="menuitem"
              className={[
                "w-full text-left px-3 py-1 whitespace-nowrap",
                isFocused
                  ? "bg-[var(--cg-hover)]"
                  : "hover:bg-[var(--cg-hover)]",
              ].join(" ")}
              onClick={() => {
                onDismiss();
                item.action?.();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────

export function FileTree({
  root,
  activePath,
  onSelect,
  onRename,
  onDelete,
  onCreateFile,
  onCreateDir,
}: FileTreeProps) {
  if (!root) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cg-muted)] italic">
        No files
      </div>
    );
  }

  const children = root.children ?? [];

  if (children.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cg-muted)] italic">
        No files
      </div>
    );
  }

  return (
    <div className="py-1">
      {children.map((entry) => (
        <FileNode
          key={entry.path}
          entry={entry}
          depth={0}
          activePath={activePath}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
          onCreateFile={onCreateFile}
          onCreateDir={onCreateDir}
        />
      ))}
    </div>
  );
}
