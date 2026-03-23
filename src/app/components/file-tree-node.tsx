import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import { FileTreeNodeFile } from "./file-tree-node-file";
import { FileTreeNodeFolder } from "./file-tree-node-folder";

interface FileTreeNodeProps {
  item: ItemInstance<FileEntry>;
}

/** Dispatches to FileTreeNodeFile or FileTreeNodeFolder based on item type. */
export function FileTreeNode({ item }: FileTreeNodeProps) {
  if (item.isFolder()) {
    return <FileTreeNodeFolder item={item} />;
  }
  return <FileTreeNodeFile item={item} />;
}
