import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import { dirname } from "../lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { useFileTreeContext } from "../contexts/file-tree-context";
import { FileIcon } from "./file-icon";
import { GitStatusBadge } from "./git-status-badge";
import { InlineCreateInput } from "./inline-create-input";
import { RenameEditor } from "./rename-editor";
import { useTreeNodeRow, ICON_SIZE, ICON_CLASS, type MenuItem } from "../hooks/use-tree-node-row";

interface FileTreeNodeFileProps {
  item: ItemInstance<FileEntry>;
}

export function FileTreeNodeFile({ item }: FileTreeNodeFileProps) {
  const { onSelect, onDoubleClick } = useFileTreeContext();

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
    createParentPath: dirname(item.getItemData().path),
  });

  const menuItems: MenuItem[] = [
    { label: "Open", action: () => onSelect(entry.path) },
    { label: "-" },
    { label: "Rename", action: startRename },
    { label: "Delete", action: deleteAction },
    { label: "-" },
    { label: "New File", action: () => startCreate("file") },
    { label: "New Folder", action: () => startCreate("folder") },
    { label: "-" },
    { label: "Copy File Name", action: copyNameAction },
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
            ref={mergedRef}
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
