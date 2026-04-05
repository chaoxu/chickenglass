import { memo } from "react";
import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import {
  areHeadlessTreeRowPropsEqual,
  type HeadlessTreeRowProps,
} from "../hooks/use-tree-node-row";
import { FileTreeNodeFile } from "./file-tree-node-file";
import { FileTreeNodeFolder } from "./file-tree-node-folder";

interface FileTreeNodeProps {
  readonly item: ItemInstance<FileEntry>;
  readonly entry: FileEntry;
  readonly depth: number;
  readonly isActive: boolean;
  readonly isFocused: boolean;
  readonly isExpanded: boolean;
  readonly rowProps: HeadlessTreeRowProps;
}

/** Dispatches to FileTreeNodeFile or FileTreeNodeFolder based on item type. */
function FileTreeNodeInner(props: FileTreeNodeProps) {
  if (props.entry.isDirectory) {
    return <FileTreeNodeFolder {...props} />;
  }
  return (
    <FileTreeNodeFile
      item={props.item}
      entry={props.entry}
      depth={props.depth}
      isActive={props.isActive}
      isFocused={props.isFocused}
      rowProps={props.rowProps}
    />
  );
}

function areFileTreeNodePropsEqual(
  prev: FileTreeNodeProps,
  next: FileTreeNodeProps,
): boolean {
  return (
    prev.item === next.item &&
    prev.entry.path === next.entry.path &&
    prev.entry.name === next.entry.name &&
    prev.entry.isDirectory === next.entry.isDirectory &&
    prev.depth === next.depth &&
    prev.isActive === next.isActive &&
    prev.isFocused === next.isFocused &&
    prev.isExpanded === next.isExpanded &&
    areHeadlessTreeRowPropsEqual(prev.rowProps, next.rowProps)
  );
}

export const FileTreeNode = memo(FileTreeNodeInner, areFileTreeNodePropsEqual);
