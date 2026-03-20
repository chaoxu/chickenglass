import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { FileEntry } from "../file-manager";
import { dirname } from "../lib/utils";
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

// ── Inline create input (VS Code-style) ─────────────────────────────────

type CreateKind = "file" | "folder";

interface InlineCreateInputProps {
  kind: CreateKind;
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function InlineCreateInput({ kind, depth, onConfirm, onCancel }: InlineCreateInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const indent = depth * 12 + 8;

  useEffect(() => {
    // Focus and select on mount
    inputRef.current?.focus();
  }, []);

  const commit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  }, [value, onConfirm, onCancel]);

  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [commit, onCancel],
  );

  return (
    <div
      className="flex items-center gap-1 px-2 py-[2px] text-sm text-[var(--cg-fg)] whitespace-nowrap"
      style={{ paddingLeft: `${indent}px` }}
    >
      {kind === "folder" ? (
        <FolderClosed size={ICON_SIZE} className={ICON_CLASS} />
      ) : (
        <File size={ICON_SIZE} className={ICON_CLASS} />
      )}
      <input
        ref={inputRef}
        type="text"
        placeholder={kind === "folder" ? "Folder name" : "File name"}
        className="flex-1 text-sm font-mono bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded px-1 outline-none min-w-0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        onBlur={onCancel}
      />
    </div>
  );
}

// ── Flatten visible entries ─────────────────────────────────────────────

/** Flatten the file tree into an ordered list of visible entries, respecting open/closed folders. */
function flattenVisible(entries: FileEntry[], openPaths: ReadonlySet<string>): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    if (entry.isDirectory && openPaths.has(entry.path) && entry.children) {
      result.push(...flattenVisible(entry.children, openPaths));
    }
  }
  return result;
}

// ── Types ────────────────────────────────────────────────────────────────

interface FileTreeProps {
  root: FileEntry | null;
  activePath: string | null;
  onSelect: (path: string) => void;
  /** Double-click a file to pin it (open as non-preview). */
  onDoubleClick?: (path: string) => void;
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
  selectedPath: string | null;
  openPaths: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onSetOpen: (path: string, open: boolean) => void;
  onSelect: (path: string) => void;
  onDoubleClick?: (path: string) => void;
  onSelectPath: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
}

function FileNode({
  entry,
  depth,
  activePath,
  selectedPath,
  openPaths,
  onToggleFolder,
  onSetOpen,
  onSelect,
  onDoubleClick,
  onSelectPath,
  onRename,
  onDelete,
  onCreateFile,
  onCreateDir,
}: FileNodeProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [creating, setCreating] = useState<CreateKind | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const indent = depth * 12 + 8;
  const isActive = entry.path === activePath;
  const isSelected = entry.path === selectedPath;
  const open = entry.isDirectory && openPaths.has(entry.path);

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
    const dir = dirname(entry.path);
    await onRename(entry.path, dir ? `${dir}/${newName}` : newName);
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

  // ── Inline create ──────────────────────────────────────────────────────

  const startCreate = useCallback(
    (kind: CreateKind) => {
      setCreating(kind);
      setContextMenu(null);
      // For directories, ensure the folder is open so the input is visible
      if (entry.isDirectory) {
        onSetOpen(entry.path, true);
      }
    },
    [entry.isDirectory, entry.path, onSetOpen],
  );

  const cancelCreate = useCallback(() => {
    setCreating(null);
  }, []);

  // ── Context menu ─────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, [entry]);

  const dismissMenu = useCallback(() => setContextMenu(null), []);

  const parentPath = dirname(entry.path);

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
        action: () => startCreate("file"),
      },
      {
        label: "New Folder",
        action: () => startCreate("folder"),
      },
      { label: "-" },
      { label: "Rename", action: startRename },
      {
        label: "Delete",
        action: () => void onDelete(entry.path),
      },
      { label: "-" },
      {
        label: "Copy File Name",
        action: () => void navigator.clipboard.writeText(entry.name),
      },
    ];

    if (revealItem) {
      dirMenuItems.push({ label: "-" }, revealItem);
    }

    const handleCreateConfirm = (name: string) => {
      const fullPath = `${entry.path}/${name}`;
      if (creating === "folder") {
        onCreateDir(fullPath);
      } else {
        onCreateFile(fullPath);
      }
      setCreating(null);
    };

    return (
      <div>
        <div
          role="button"
          tabIndex={-1}
          className={[
            "flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm text-[var(--cg-fg)] select-none whitespace-nowrap",
            isSelected
              ? "bg-[var(--cg-active)]"
              : "hover:bg-[var(--cg-hover)]",
          ].join(" ")}
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => {
            onSelectPath(entry.path);
            onToggleFolder(entry.path);
          }}
          onContextMenu={handleContextMenu}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onToggleFolder(entry.path);
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

        {open && (
          <div>
            {/* Inline create input appears as first child inside the directory */}
            {creating && (
              <InlineCreateInput
                kind={creating}
                depth={depth + 1}
                onConfirm={handleCreateConfirm}
                onCancel={cancelCreate}
              />
            )}
            {entry.children?.map((child) => (
              <FileNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                activePath={activePath}
                selectedPath={selectedPath}
                openPaths={openPaths}
                onToggleFolder={onToggleFolder}
                onSetOpen={onSetOpen}
                onSelect={onSelect}
                onDoubleClick={onDoubleClick}
                onSelectPath={onSelectPath}
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

  const handleFileCreateConfirm = (name: string) => {
    const base = parentPath || "";
    const fullPath = base ? `${base}/${name}` : name;
    if (creating === "folder") {
      onCreateDir(fullPath);
    } else {
      onCreateFile(fullPath);
    }
    setCreating(null);
  };

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
      action: () => startCreate("file"),
    },
    {
      label: "New Folder",
      action: () => startCreate("folder"),
    },
    { label: "-" },
    {
      label: "Copy File Name",
      action: () => void navigator.clipboard.writeText(entry.name),
    },
  ];

  if (revealItem) {
    fileMenuItems.push({ label: "-" }, revealItem);
  }

  return (
    <>
      <div
        role="button"
        tabIndex={-1}
        className={[
          "flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm text-[var(--cg-fg)] select-none whitespace-nowrap",
          isActive || isSelected
            ? "bg-[var(--cg-active)]"
            : "hover:bg-[var(--cg-hover)]",
        ].join(" ")}
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => {
          onSelectPath(entry.path);
          onSelect(entry.path);
        }}
        onDoubleClick={() => {
          onDoubleClick?.(entry.path);
        }}
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

      {/* Inline create input appears as sibling row below the file */}
      {creating && (
        <InlineCreateInput
          kind={creating}
          depth={depth}
          onConfirm={handleFileCreateConfirm}
          onCancel={cancelCreate}
        />
      )}
    </>
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
        className="fixed z-50 min-w-[160px] py-1 bg-[var(--cg-bg)] border border-[var(--cg-border)] ring-1 ring-[var(--cg-border)] rounded text-sm text-[var(--cg-fg)] outline-none"
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
  onDoubleClick,
  onRename,
  onDelete,
  onCreateFile,
  onCreateDir,
}: FileTreeProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set());

  const children = root?.children ?? [];

  // Flatten visible entries for keyboard navigation
  const visibleEntries = useMemo(
    () => flattenVisible(children, openPaths),
    [children, openPaths],
  );

  const toggleFolder = useCallback((path: string) => {
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const setFolderOpen = useCallback((path: string, isOpen: boolean) => {
    setOpenPaths((prev) => {
      if (isOpen && prev.has(path)) return prev;
      if (!isOpen && !prev.has(path)) return prev;
      const next = new Set(prev);
      if (isOpen) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (visibleEntries.length === 0) return;

      // Don't interfere with input elements (rename, inline create)
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") return;

      // Compute current index once for all key handlers
      const currentIndex = selectedPath
        ? visibleEntries.findIndex((v) => v.path === selectedPath)
        : -1;
      const currentEntry = currentIndex >= 0 ? visibleEntries[currentIndex] : null;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIndex = currentIndex + 1;
        const target = nextIndex < visibleEntries.length
          ? visibleEntries[nextIndex]
          : currentIndex === -1 ? visibleEntries[0] : null;
        if (target) {
          setSelectedPath(target.path);
          if (!target.isDirectory) onSelect(target.path);
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const target = currentIndex > 0
          ? visibleEntries[currentIndex - 1]
          : currentIndex === -1 ? visibleEntries[visibleEntries.length - 1] : null;
        if (target) {
          setSelectedPath(target.path);
          if (!target.isDirectory) onSelect(target.path);
        }
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (!currentEntry) return;
        if (currentEntry.isDirectory) {
          toggleFolder(currentEntry.path);
        } else {
          onSelect(currentEntry.path);
        }
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (currentEntry?.isDirectory && !openPaths.has(currentEntry.path)) {
          setFolderOpen(currentEntry.path, true);
        }
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentEntry?.isDirectory && openPaths.has(currentEntry.path)) {
          setFolderOpen(currentEntry.path, false);
        }
        return;
      }
    },
    [visibleEntries, selectedPath, toggleFolder, setFolderOpen, onSelect, openPaths],
  );

  if (!root) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cg-muted)] italic">
        No files
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cg-muted)] italic">
        No files
      </div>
    );
  }

  return (
    <div
      className="py-1 outline-none"
      tabIndex={0}
      role="tree"
      onKeyDown={handleKeyDown}
    >
      {children.map((entry) => (
        <FileNode
          key={entry.path}
          entry={entry}
          depth={0}
          activePath={activePath}
          selectedPath={selectedPath}
          openPaths={openPaths}
          onToggleFolder={toggleFolder}
          onSetOpen={setFolderOpen}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
          onSelectPath={setSelectedPath}
          onRename={onRename}
          onDelete={onDelete}
          onCreateFile={onCreateFile}
          onCreateDir={onCreateDir}
        />
      ))}
    </div>
  );
}
