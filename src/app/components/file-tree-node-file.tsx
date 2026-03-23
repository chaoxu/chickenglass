import { useState, useCallback, useRef } from "react";
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
import { useFileTreeContext } from "../contexts/file-tree-context";
import { FileIcon } from "./file-icon";
import { InlineCreateInput } from "./inline-create-input";
import { RenameEditor } from "./rename-editor";

type CreateKind = "file" | "folder";

interface MenuItem {
  label: string;
  action?: () => void;
}

const ICON_SIZE = 14;
const ICON_CLASS = "shrink-0 text-[var(--cf-muted)]";

interface FileTreeNodeFileProps {
  item: ItemInstance<FileEntry>;
}

export function FileTreeNodeFile({ item }: FileTreeNodeFileProps) {
  const { activePath, onSelect, onDoubleClick, onRename, onDelete, onCreateFile, onCreateDir } =
    useFileTreeContext();

  const entry = item.getItemData();
  // headless-tree levels are 0-based (root children = 0), map directly to visual depth
  const depth = item.getItemMeta().level;
  const indent = depth * 12 + 8;

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState<CreateKind | null>(null);

  const isActive = entry.path === activePath;
  const isFocused = item.isFocused();
  const rowRef = useRef<HTMLDivElement | null>(null);

  const restoreFocus = useCallback(() => {
    rowRef.current?.focus();
  }, []);

  const startRename = useCallback(() => {
    setRenameValue(entry.name);
    setRenaming(true);
  }, [entry.name]);

  const commitRename = useCallback(async () => {
    const newName = renameValue.trim();
    setRenaming(false);
    if (!newName || newName === entry.name) {
      restoreFocus();
      return;
    }
    const dir = dirname(entry.path);
    await onRename(entry.path, dir ? `${dir}/${newName}` : newName);
    restoreFocus();
  }, [entry.name, entry.path, onRename, renameValue, restoreFocus]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  const startCreate = useCallback((kind: CreateKind) => {
    setCreating(kind);
  }, []);

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

  const revealItem: MenuItem | null = isTauri()
    ? {
        label: "Reveal in Finder",
        action: () => {
          void revealInFinder(entry.path).catch((e: unknown) => {
            console.error("[file-tree] revealInFinder failed:", e);
          });
        },
      }
    : null;

  const menuItems: MenuItem[] = [
    { label: "Open", action: () => onSelect(entry.path) },
    { label: "-" },
    { label: "Rename", action: startRename },
    {
      label: "Delete",
      action: () => {
        void onDelete(entry.path).then(restoreFocus).catch((e: unknown) => {
          console.error("[file-tree] delete failed:", e);
        });
      },
    },
    { label: "-" },
    { label: "New File", action: () => startCreate("file") },
    { label: "New Folder", action: () => startCreate("folder") },
    { label: "-" },
    {
      label: "Copy File Name",
      action: () => {
        void navigator.clipboard.writeText(entry.name).catch((e: unknown) => {
          console.error("[file-tree] clipboard write failed:", e);
        });
      },
    },
  ];

  if (revealItem) {
    menuItems.push({ label: "-" }, revealItem);
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            {...rowProps}
            ref={rowRef}
            className={[
              "flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm text-[var(--cf-fg)] select-none whitespace-nowrap",
              isActive || isFocused ? "bg-[var(--cf-active)]" : "hover:bg-[var(--cf-hover)]",
            ].join(" ")}
            style={{ paddingLeft: `${indent}px` }}
            onClick={handleClick}
            onDoubleClick={() => onDoubleClick?.(entry.path)}
            onContextMenu={handleContextSelection}
            onKeyDown={handleRowKey}
          >
            <FileIcon name={entry.name} size={ICON_SIZE} className={ICON_CLASS} />
            {renaming ? (
              <RenameEditor
                value={renameValue}
                onChange={setRenameValue}
                onCommit={() => {
                  void commitRename().catch((e: unknown) => {
                    console.error("[file-tree] commitRename failed:", e);
                  });
                }}
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
