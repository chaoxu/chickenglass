import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { FolderClosed, FolderOpen } from "lucide-react";
import { GitStatusBadge } from "./git-status-badge";
import { InlineCreateInput } from "./inline-create-input";
import { RenameEditor } from "./rename-editor";
import { useTreeNodeRow, ICON_SIZE, ICON_CLASS, type MenuItem } from "../hooks/use-tree-node-row";

interface FileTreeNodeFolderProps {
  item: ItemInstance<FileEntry>;
}

export function FileTreeNodeFolder({ item }: FileTreeNodeFolderProps) {
  const open = item.isExpanded();

  const {
    entry, depth, indent,
    renaming, renameValue, setRenameValue, creating,
    isActive, isFocused,
    mergedRef, rowProps, gitStatus,
    startRename, commitRename, cancelRename,
    startCreate, cancelCreate, handleCreateConfirm,
    handleClick, handleContextSelection, handleRowKey,
    revealItem, deleteAction, copyNameAction,
  } = useTreeNodeRow({
    item,
    createParentPath: item.getItemData().path,
    onBeforeCreate: () => item.expand(),
  });

  const menuItems: MenuItem[] = [
    { label: "New File", action: () => startCreate("file") },
    { label: "New Folder", action: () => startCreate("folder") },
    { label: "-" },
    { label: "Rename", action: startRename },
    { label: "Delete", action: deleteAction },
    { label: "-" },
    { label: "Copy File Name", action: copyNameAction },
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
            ref={mergedRef}
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
            {gitStatus[entry.path] && <GitStatusBadge status={gitStatus[entry.path]} />}
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
