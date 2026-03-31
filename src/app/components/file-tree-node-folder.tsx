import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import { FolderClosed, FolderOpen } from "lucide-react";
import { InlineCreateInput } from "./inline-create-input";
import { RenameEditor } from "./rename-editor";
import { TreeNodeRow } from "./tree-node-row";
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
    mergedRef, rowProps,
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
      <TreeNodeRow
        rowProps={rowProps}
        mergedRef={mergedRef}
        indent={indent}
        isActive={isActive}
        isFocused={isFocused}
        icon={
          open ? (
            <FolderOpen size={ICON_SIZE} className={ICON_CLASS} />
          ) : (
            <FolderClosed size={ICON_SIZE} className={ICON_CLASS} />
          )
        }
        menuItems={menuItems}
        onRowClick={handleClick}
        onContextSelection={handleContextSelection}
        onRowKeyDown={handleRowKey}
      >
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
      </TreeNodeRow>

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
