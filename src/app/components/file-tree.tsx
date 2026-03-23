import type { FileEntry } from "../file-manager";
import { FileTreeNode } from "./file-tree-node";
import { FileTreeProvider } from "../contexts/file-tree-context";
import { useFileTreeController } from "../hooks/use-file-tree-controller";

interface FileTreeProps {
  root: FileEntry | null;
  activePath: string | null;
  onSelect: (path: string) => void;
  onDoubleClick?: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
}

export function FileTree({
  root,
  activePath,
  onSelect,
  onDoubleClick,
  onRename,
  onDelete,
  onCreateFile,
  onCreateDir,
}: FileTreeProps) {
  const controller = useFileTreeController({ root, onSelect });

  if (!root || controller.visibleItems.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cf-muted)] italic">
        No files
      </div>
    );
  }

  return (
    <FileTreeProvider
      value={{ activePath, onSelect, onDoubleClick, onRename, onDelete, onCreateFile, onCreateDir }}
    >
      <div
        {...controller.tree.getContainerProps("Files")}
        className="py-1 outline-none"
      >
        {controller.visibleItems.map((item) => (
          <FileTreeNode key={item.getId()} item={item} />
        ))}
      </div>
    </FileTreeProvider>
  );
}
