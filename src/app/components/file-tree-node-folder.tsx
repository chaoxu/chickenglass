import { useMemo } from "react";
import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import { FolderClosed, FolderOpen } from "lucide-react";
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

interface FileTreeNodeFolderProps {
  readonly item: ItemInstance<FileEntry>;
  readonly entry: FileEntry;
  readonly depth: number;
  readonly isActive: boolean;
  readonly isFocused: boolean;
  readonly isExpanded: boolean;
  readonly rowProps: HeadlessTreeRowProps;
}

export function FileTreeNodeFolder({
  item,
  entry,
  depth,
  isActive,
  isFocused,
  isExpanded,
  rowProps,
}: FileTreeNodeFolderProps) {
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
    createParentPath: entry.path,
    onBeforeCreate: () => item.expand(),
  });

  const icon = useMemo(
    () => (
      isExpanded ? (
        <FolderOpen size={ICON_SIZE} className={ICON_CLASS} />
      ) : (
        <FolderClosed size={ICON_SIZE} className={ICON_CLASS} />
      )
    ),
    [isExpanded],
  );

  const menuItems = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [
      { label: "New File", action: () => startCreate("file") },
      { label: "New Folder", action: () => startCreate("folder") },
      { label: "-" },
      { label: "Rename", action: startRename },
      { label: "Delete", action: deleteAction },
      { label: "-" },
      { label: "Copy File Name", action: copyNameAction },
    ];

    if (revealItem) {
      items.push({ label: "-" }, revealItem);
    }

    return items;
  }, [copyNameAction, deleteAction, revealItem, startCreate, startRename]);

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

  return (
    <div>
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
      >
        {rowChildren}
      </TreeNodeRow>

      {isExpanded && creating && (
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
