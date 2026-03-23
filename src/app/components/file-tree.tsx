import { useEffect, useRef } from "react";
import type { FileEntry } from "../file-manager";
import { FileTreeNode } from "./file-tree-node";
import { FileTreeProvider } from "../contexts/file-tree-context";
import {
  useFileTreeController,
  type PersistentTreeState,
} from "../hooks/use-file-tree-controller";

interface FileTreeProps {
  root: FileEntry | null;
  activePath: string | null;
  onSelect: (path: string) => void;
  onDoubleClick?: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
  /** When provided, tree state (expanded folders, focus, scroll) persists across unmount/remount. */
  persistRef?: React.MutableRefObject<PersistentTreeState>;
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
  persistRef,
}: FileTreeProps) {
  const controller = useFileTreeController({ root, onSelect, persistRef });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const saveScrollRef = useRef(controller.saveScrollPosition);
  saveScrollRef.current = controller.saveScrollPosition;

  // Restore scroll position on mount, save on unmount.
  // Uses a ref callback to capture the initial savedScrollTop value at mount time.
  const initialScrollTop = useRef(controller.savedScrollTop);
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (el && initialScrollTop.current > 0) {
      el.scrollTop = initialScrollTop.current;
    }
    return () => {
      const scrollEl = containerRef.current?.parentElement;
      if (scrollEl) {
        saveScrollRef.current(scrollEl.scrollTop);
      }
    };
  }, []);

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
        ref={containerRef}
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
