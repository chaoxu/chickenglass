import type { FileEntry } from "../file-manager";
import { FileTreeNode } from "./file-tree-node";
import { useFileTreeController } from "../hooks/use-file-tree-controller";

// ── Types ────────────────────────────────────────────────────────────────

interface FileTreeProps {
  root: FileEntry | null;
  activePath: string | null;
  onSelect: (path: string) => void;
  /** Double-click a file to pin it (open as non-preview). */
  onDoubleClick?: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
}

// ── Public component ──────────────────────────────────────────────────────

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
  const children = root?.children ?? [];

  if (!root) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cg-muted)] italic">
        No files
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--cg-muted)] italic">
        No files
      </div>
    );
  }

  return (
    <div
      className="py-1 outline-none"
      tabIndex={0}
      role="tree"
      onKeyDown={controller.handleKeyDown}
    >
      {children.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          activePath={activePath}
          selectedPath={controller.selectedPath}
          openPaths={controller.openPaths}
          onToggleFolder={controller.toggleFolder}
          onSetOpen={controller.setFolderOpen}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
          onSelectPath={controller.setSelectedPath}
          onRename={onRename}
          onDelete={onDelete}
          onCreateFile={onCreateFile}
          onCreateDir={onCreateDir}
        />
      ))}
    </div>
  );
}
