import { useState, useRef, useCallback } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { FileEntry } from "../file-manager";

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

  // ── Directory rendering ───────────────────────────────────────────────────

  if (entry.isDirectory) {
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
          }}
        >
          <span className="text-[10px] text-[var(--cg-muted)] w-3 shrink-0">
            {open ? "▼" : "▶"}
          </span>
          <span className="font-mono truncate">{entry.name}</span>
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
            items={[
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
            ]}
          />
        )}
      </div>
    );
  }

  // ── File rendering ────────────────────────────────────────────────────────

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
      <span className="text-[10px] text-[var(--cg-muted)] w-3 shrink-0">○</span>

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
          items={[
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
          ]}
        />
      )}
    </div>
  );
}

// ── Simple positioned context menu (no shadcn) ────────────────────────────

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
        className="fixed z-50 min-w-[140px] py-1 bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded text-sm text-[var(--cg-fg)]"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item, i) =>
          item.label === "-" ? (
            <div key={i} className="my-1 border-t border-[var(--cg-border)]" />
          ) : (
            <button
              key={i}
              className="w-full text-left px-3 py-1 hover:bg-[var(--cg-hover)] whitespace-nowrap"
              onClick={() => {
                onDismiss();
                item.action?.();
              }}
            >
              {item.label}
            </button>
          ),
        )}
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
