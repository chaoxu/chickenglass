import { useState, useRef, useCallback, useEffect } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import { dirname } from "../lib/utils";
import { isTauri, revealInFinder } from "../tauri-fs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
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

type CreateKind = "file" | "folder";

interface MenuItem {
  label: string;
  action?: () => void;
}

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

interface InlineCreateInputProps {
  kind: CreateKind;
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function InlineCreateInput({
  kind,
  depth,
  onConfirm,
  onCancel,
}: InlineCreateInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const indent = depth * 12 + 8;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  }, [onCancel, onConfirm, value]);

  const handleKey = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }, [commit, onCancel]);

  return (
    <div
      className="flex items-center gap-1 px-2 py-[2px] text-sm text-[var(--cg-fg)] whitespace-nowrap"
      style={{ paddingLeft: `${indent}px` }}
    >
      {kind === "folder"
        ? <FolderClosed size={ICON_SIZE} className={ICON_CLASS} />
        : <File size={ICON_SIZE} className={ICON_CLASS} />}
      <input
        ref={inputRef}
        type="text"
        placeholder={kind === "folder" ? "Folder name" : "File name"}
        className="flex-1 text-sm cg-ui-font bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded px-1 outline-none min-w-0"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKey}
        onBlur={onCancel}
      />
    </div>
  );
}

interface FileTreeNodeProps {
  item: ItemInstance<FileEntry>;
  activePath: string | null;
  onSelect: (path: string) => void;
  onDoubleClick?: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
}

export function FileTreeNode({
  item,
  activePath,
  onSelect,
  onDoubleClick,
  onRename,
  onDelete,
  onCreateFile,
  onCreateDir,
}: FileTreeNodeProps) {
  const entry = item.getItemData();
  const depth = Math.max(0, item.getItemMeta().level - 1);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState<CreateKind | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const indent = depth * 12 + 8;
  const isActive = entry.path === activePath;
  const isFocused = item.isFocused();
  const isFolder = item.isFolder();
  const open = isFolder && item.isExpanded();

  const startRename = useCallback(() => {
    setRenameValue(entry.name);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [entry.name]);

  const commitRename = useCallback(async () => {
    const newName = renameValue.trim();
    setRenaming(false);
    if (!newName || newName === entry.name) return;
    const dir = dirname(entry.path);
    await onRename(entry.path, dir ? `${dir}/${newName}` : newName);
  }, [entry.name, entry.path, onRename, renameValue]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  const handleRenameKey = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }, [cancelRename, commitRename]);

  const handleRowKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "F2") {
      event.preventDefault();
      startRename();
    }
  }, [startRename]);

  const startCreate = useCallback((kind: CreateKind) => {
    setCreating(kind);
    if (isFolder) {
      item.expand();
    }
  }, [isFolder, item]);

  const cancelCreate = useCallback(() => {
    setCreating(null);
  }, []);

  const revealItem: MenuItem | null = isTauri()
    ? {
        label: "Reveal in Finder",
        action: () => void revealInFinder(entry.path),
      }
    : null;

  const rowProps = item.getProps();

  const handleFolderClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    rowProps.onClick?.(event.nativeEvent);
  };

  const handleFileClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    rowProps.onClick?.(event.nativeEvent);
  };

  const handleContextSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    item.setFocused();
  };

  if (isFolder) {
    const handleCreateConfirm = (name: string) => {
      const fullPath = `${entry.path}/${name}`;
      if (creating === "folder") {
        onCreateDir(fullPath);
      } else {
        onCreateFile(fullPath);
      }
      setCreating(null);
    };

    const dirMenuItems: MenuItem[] = [
      { label: "New File", action: () => startCreate("file") },
      { label: "New Folder", action: () => startCreate("folder") },
      { label: "-" },
      { label: "Rename", action: startRename },
      { label: "Delete", action: () => void onDelete(entry.path) },
      { label: "-" },
      {
        label: "Copy File Name",
        action: () => void navigator.clipboard.writeText(entry.name),
      },
    ];

    if (revealItem) {
      dirMenuItems.push({ label: "-" }, revealItem);
    }

    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              {...rowProps}
              className={[
                "flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm text-[var(--cg-fg)] select-none whitespace-nowrap",
                isActive || isFocused ? "bg-[var(--cg-active)]" : "hover:bg-[var(--cg-hover)]",
              ].join(" ")}
              style={{ paddingLeft: `${indent}px` }}
              onClick={handleFolderClick}
              onContextMenu={handleContextSelection}
              onKeyDown={handleRowKey}
            >
              {open
                ? <FolderOpen size={ICON_SIZE} className={ICON_CLASS} />
                : <FolderClosed size={ICON_SIZE} className={ICON_CLASS} />}

              {renaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  className="flex-1 text-sm cg-ui-font bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded px-1 outline-none min-w-0"
                  value={renameValue}
                  autoFocus
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={handleRenameKey}
                  onBlur={cancelRename}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : (
                <span className="cg-ui-font truncate">{entry.name}</span>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-[160px]">
            {dirMenuItems.map((menuItem, index) => (
              menuItem.label === "-"
                ? <ContextMenuSeparator key={index} />
                : (
                  <ContextMenuItem key={index} onSelect={() => menuItem.action?.()}>
                    {menuItem.label}
                  </ContextMenuItem>
                )
            ))}
          </ContextMenuContent>
        </ContextMenu>

        {open && creating && (
          <InlineCreateInput
            kind={creating}
            depth={depth + 1}
            onConfirm={handleCreateConfirm}
            onCancel={cancelCreate}
          />
        )}
      </div>
    );
  }

  const parentPath = dirname(entry.path);
  const handleCreateConfirm = (name: string) => {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
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
    { label: "Delete", action: () => void onDelete(entry.path) },
    { label: "-" },
    { label: "New File", action: () => startCreate("file") },
    { label: "New Folder", action: () => startCreate("folder") },
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            {...rowProps}
            className={[
              "flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm text-[var(--cg-fg)] select-none whitespace-nowrap",
              isActive || isFocused ? "bg-[var(--cg-active)]" : "hover:bg-[var(--cg-hover)]",
            ].join(" ")}
            style={{ paddingLeft: `${indent}px` }}
            onClick={handleFileClick}
            onDoubleClick={() => {
              onDoubleClick?.(entry.path);
            }}
            onContextMenu={handleContextSelection}
            onKeyDown={handleRowKey}
          >
            <FileIcon name={entry.name} />

            {renaming ? (
              <input
                ref={renameInputRef}
                type="text"
                className="flex-1 text-sm cg-ui-font bg-[var(--cg-bg)] border border-[var(--cg-border)] rounded px-1 outline-none min-w-0"
                value={renameValue}
                autoFocus
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={handleRenameKey}
                onBlur={cancelRename}
                onClick={(event) => event.stopPropagation()}
              />
            ) : (
              <span className="cg-ui-font truncate">{entry.name}</span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[160px]">
          {fileMenuItems.map((menuItem, index) => (
            menuItem.label === "-"
              ? <ContextMenuSeparator key={index} />
              : (
                <ContextMenuItem key={index} onSelect={() => menuItem.action?.()}>
                  {menuItem.label}
                </ContextMenuItem>
              )
          ))}
        </ContextMenuContent>
      </ContextMenu>

      {creating && (
        <InlineCreateInput
          kind={creating}
          depth={depth}
          onConfirm={handleCreateConfirm}
          onCancel={cancelCreate}
        />
      )}
    </>
  );
}
