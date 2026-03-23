import { useState, useCallback } from "react";
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
import { FolderClosed, FolderOpen } from "lucide-react";
import { useFileTreeContext } from "../contexts/file-tree-context";
import { InlineCreateInput } from "./inline-create-input";
import { RenameEditor } from "./rename-editor";

type CreateKind = "file" | "folder";

interface MenuItem {
  label: string;
  action?: () => void;
}

const ICON_SIZE = 14;
const ICON_CLASS = "shrink-0 text-[var(--cf-muted)]";

interface FileTreeNodeFolderProps {
  item: ItemInstance<FileEntry>;
}

export function FileTreeNodeFolder({ item }: FileTreeNodeFolderProps) {
  const { activePath, onRename, onDelete, onCreateFile, onCreateDir } = useFileTreeContext();

  const entry = item.getItemData();
  const depth = Math.max(0, item.getItemMeta().level - 1);
  const indent = depth * 12 + 8;

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState<CreateKind | null>(null);

  const isActive = entry.path === activePath;
  const isFocused = item.isFocused();
  const open = item.isExpanded();

  const startRename = useCallback(() => {
    setRenameValue(entry.name);
    setRenaming(true);
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

  const startCreate = useCallback(
    (kind: CreateKind) => {
      setCreating(kind);
      item.expand();
    },
    [item],
  );

  const cancelCreate = useCallback(() => {
    setCreating(null);
  }, []);

  const rowProps = item.getProps();

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    rowProps.onClick?.(event.nativeEvent);
  };

  const handleContextSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    item.setFocused();
  };

  const handleRowKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "F2") {
        event.preventDefault();
        startRename();
      }
    },
    [startRename],
  );

  const handleCreateConfirm = (name: string) => {
    const fullPath = `${entry.path}/${name}`;
    if (creating === "folder") {
      onCreateDir(fullPath);
    } else {
      onCreateFile(fullPath);
    }
    setCreating(null);
  };

  const revealItem: MenuItem | null = isTauri()
    ? { label: "Reveal in Finder", action: () => void revealInFinder(entry.path) }
    : null;

  const menuItems: MenuItem[] = [
    { label: "New File", action: () => startCreate("file") },
    { label: "New Folder", action: () => startCreate("folder") },
    { label: "-" },
    { label: "Rename", action: startRename },
    { label: "Delete", action: () => void onDelete(entry.path) },
    { label: "-" },
    { label: "Copy File Name", action: () => void navigator.clipboard.writeText(entry.name) },
  ];

  if (revealItem) {
    menuItems.push({ label: "-" }, revealItem);
  }

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            {...rowProps}
            className={[
              "flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm text-[var(--cf-fg)] select-none whitespace-nowrap",
              isActive || isFocused ? "bg-[var(--cf-active)]" : "hover:bg-[var(--cf-hover)]",
            ].join(" ")}
            style={{ paddingLeft: `${indent}px` }}
            onClick={handleClick}
            onContextMenu={handleContextSelection}
            onKeyDown={handleRowKey}
          >
            {open ? (
              <FolderOpen size={ICON_SIZE} className={ICON_CLASS} />
            ) : (
              <FolderClosed size={ICON_SIZE} className={ICON_CLASS} />
            )}
            {renaming ? (
              <RenameEditor
                value={renameValue}
                onChange={setRenameValue}
                onCommit={() => void commitRename()}
                onCancel={cancelRename}
              />
            ) : (
              <span className="cf-ui-font truncate">{entry.name}</span>
            )}
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
