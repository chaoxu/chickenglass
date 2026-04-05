import { useCallback, useMemo } from "react";
import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import { dirname } from "../lib/utils";
import { useFileTreeContext } from "../contexts/file-tree-context";
import { FileIcon } from "./file-icon";
import { InlineCreateInput } from "./inline-create-input";
import { RenameEditor } from "./rename-editor";
import { TreeNodeRow } from "./tree-node-row";
import {
  useTreeNodeRow,
  ICON_SIZE,
  ICON_CLASS,
  type HeadlessTreeRowProps,
  type MenuItem,
} from "../hooks/use-tree-node-row";

interface FileTreeNodeFileProps {
  readonly item: ItemInstance<FileEntry>;
  readonly entry: FileEntry;
  readonly depth: number;
  readonly isActive: boolean;
  readonly isFocused: boolean;
  readonly rowProps: HeadlessTreeRowProps;
}

export function FileTreeNodeFile({
  item,
  entry,
  depth,
  isActive,
  isFocused,
  rowProps,
}: FileTreeNodeFileProps) {
  const { onSelect, onDoubleClick } = useFileTreeContext();

  const {
    indent,
    renaming, renameValue, setRenameValue, creating,
    mergedRef, rowProps: resolvedRowProps,
    startRename, commitRename, cancelRename,
    startCreate, cancelCreate, handleCreateConfirm,
    handleClick, handleContextSelection, handleRowKey,
    revealItem, deleteAction, copyNameAction,
  } = useTreeNodeRow({
    item,
    entry,
    depth,
    isActive,
    isFocused,
    rowProps,
    createParentPath: dirname(entry.path),
  });

  const icon = useMemo(
    () => <FileIcon name={entry.name} size={ICON_SIZE} className={ICON_CLASS} />,
    [entry.name],
  );

  const menuItems = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [
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
      items.push({ label: "-" }, revealItem);
    }

    return items;
  }, [copyNameAction, deleteAction, entry.path, onSelect, revealItem, startCreate, startRename]);

  const rowChildren = useMemo(
    () => (renaming ? (
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
    )),
    [cancelRename, commitRename, entry.name, renameValue, renaming, setRenameValue],
  );

  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.(entry.path);
  }, [entry.path, onDoubleClick]);

  return (
    <>
      <TreeNodeRow
        rowProps={resolvedRowProps}
        mergedRef={mergedRef}
        indent={indent}
        isActive={isActive}
        isFocused={isFocused}
        icon={icon}
        menuItems={menuItems}
        onRowClick={handleClick}
        onContextSelection={handleContextSelection}
        onRowKeyDown={handleRowKey}
        onDoubleClick={handleDoubleClick}
      >
        {rowChildren}
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
