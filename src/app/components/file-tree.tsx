import { useEffect, useMemo, useRef } from "react";
import type { FileEntry } from "../file-manager";
import { FileTreeNode } from "./file-tree-node";
import { FileTreeProvider } from "../contexts/file-tree-context";
import { useFileTreeController, type PersistentTreeState } from "../hooks/use-file-tree-controller";

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
  persistRef?: React.RefObject<PersistentTreeState>;
  /** Load children for a directory on expand (lazy tree loading). */
  onLoadChildren?: (dirPath: string) => void;
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
  onLoadChildren,
}: FileTreeProps) {
  const controller = useFileTreeController({ root, onSelect, persistRef, onLoadChildren });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const saveScrollRef = useRef(controller.saveScrollPosition);
  saveScrollRef.current = controller.saveScrollPosition;

  // Restore scroll position on mount, save on unmount.
  // The file tree lives inside a Radix ScrollArea whose Viewport element
  // (marked with [data-radix-scroll-area-viewport]) is the actual scroll
  // container — NOT containerRef.parentElement (which is TabsContent).
  // We use a ResizeObserver because headless-tree renders items lazily based
  // on expanded state — at mount time the container may be too short to
  // scroll, so the browser clamps scrollTop to 0.
  const initialScrollTop = useRef(controller.savedScrollTop);
  useEffect(() => {
    const scrollEl = containerRef.current?.closest<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    let observer: ResizeObserver | undefined;
    if (initialScrollTop.current > 0 && scrollEl) {
      observer = new ResizeObserver(() => {
        if (scrollEl.scrollHeight >= initialScrollTop.current) {
          scrollEl.scrollTop = initialScrollTop.current;
          observer?.disconnect();
          observer = undefined;
        }
      });
      observer.observe(scrollEl);
    }
    return () => {
      observer?.disconnect();
      const el = containerRef.current?.closest<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      );
      if (el) {
        saveScrollRef.current(el.scrollTop);
      }
    };
  }, []);

  // Merge local containerRef with headless-tree's container ref so both
  // the scroll-position logic and updateDomFocus() work correctly (#462).
  const containerProps = controller.tree.getContainerProps("Files");
  const mergedContainerRef = useMemo(() => {
    const htRef = containerProps.ref;
    return (el: HTMLDivElement | null) => {
      containerRef.current = el;
      if (typeof htRef === "function") htRef(el);
      else if (htRef && typeof htRef === "object")
        (htRef as React.RefObject<HTMLDivElement | null>).current = el;
    };
  }, [containerProps.ref]);

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
        {...containerProps}
        ref={mergedContainerRef}
        className="py-1 outline-none"
      >
        {controller.visibleItems.map((item) => (
          <FileTreeNode key={item.getId()} item={item} />
        ))}
      </div>
    </FileTreeProvider>
  );
}
