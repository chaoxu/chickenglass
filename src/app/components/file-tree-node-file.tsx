import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import { dirname } from "../lib/utils";
import { useFileTreeContext } from "../contexts/file-tree-context";
import { FileIcon } from "./file-icon";
import { GitStatusBadge } from "./git-status-badge";
import { InlineCreateInput } from "./inline-create-input";
import { RenameEditor } from "./rename-editor";
import { TreeNodeRow } from "./tree-node-row";
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
      <TreeNodeRow
        rowProps={rowProps}
        mergedRef={mergedRef}
        indent={indent}
        isActive={isActive}
        isFocused={isFocused}
        icon={<FileIcon name={entry.name} size={ICON_SIZE} className={ICON_CLASS} />}
        menuItems={menuItems}
        onRowClick={handleClick}
        onContextSelection={handleContextSelection}
        onRowKeyDown={handleRowKey}
        onDoubleClick={() => onDoubleClick?.(entry.path)}
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
        {gitStatus[entry.path] && <GitStatusBadge status={gitStatus[entry.path]} />}
      </TreeNodeRow>

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
