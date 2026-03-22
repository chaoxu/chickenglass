import { useState, useMemo, useCallback } from "react";
import type { KeyboardEvent } from "react";
import type { FileEntry } from "../file-manager";

export interface FileTreeKeyResult {
  readonly handled: boolean;
  readonly nextSelectedPath?: string;
  readonly activatePath?: string;
  readonly toggleFolderPath?: string;
  readonly setFolderOpen?: {
    readonly path: string;
    readonly open: boolean;
  };
}

/** Flatten the tree to the currently visible rows, respecting open folders. */
export function flattenVisibleEntries(
  entries: readonly FileEntry[],
  openPaths: ReadonlySet<string>,
): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    if (entry.isDirectory && openPaths.has(entry.path) && entry.children) {
      result.push(...flattenVisibleEntries(entry.children, openPaths));
    }
  }
  return result;
}

function getCurrentEntry(
  visibleEntries: readonly FileEntry[],
  selectedPath: string | null,
): {
  readonly currentIndex: number;
  readonly currentEntry: FileEntry | null;
} {
  const currentIndex = selectedPath
    ? visibleEntries.findIndex((entry) => entry.path === selectedPath)
    : -1;

  return {
    currentIndex,
    currentEntry: currentIndex >= 0 ? visibleEntries[currentIndex] : null,
  };
}

function getAdjacentEntry(
  visibleEntries: readonly FileEntry[],
  selectedPath: string | null,
  direction: 1 | -1,
): FileEntry | null {
  if (visibleEntries.length === 0) return null;

  const { currentIndex } = getCurrentEntry(visibleEntries, selectedPath);
  if (direction === 1) {
    if (currentIndex === -1) return visibleEntries[0];
    return currentIndex + 1 < visibleEntries.length
      ? visibleEntries[currentIndex + 1]
      : null;
  }

  if (currentIndex === -1) return visibleEntries[visibleEntries.length - 1];
  return currentIndex > 0 ? visibleEntries[currentIndex - 1] : null;
}

/** Resolve a tree-level keyboard event into state transitions and actions. */
export function resolveFileTreeKey(
  key: string,
  visibleEntries: readonly FileEntry[],
  selectedPath: string | null,
  openPaths: ReadonlySet<string>,
): FileTreeKeyResult {
  if (visibleEntries.length === 0) return { handled: false };

  const { currentEntry } = getCurrentEntry(visibleEntries, selectedPath);

  if (key === "ArrowDown") {
    const target = getAdjacentEntry(visibleEntries, selectedPath, 1);
    return target
      ? {
          handled: true,
          nextSelectedPath: target.path,
          activatePath: target.isDirectory ? undefined : target.path,
        }
      : { handled: true };
  }

  if (key === "ArrowUp") {
    const target = getAdjacentEntry(visibleEntries, selectedPath, -1);
    return target
      ? {
          handled: true,
          nextSelectedPath: target.path,
          activatePath: target.isDirectory ? undefined : target.path,
        }
      : { handled: true };
  }

  if (key === "Enter") {
    if (!currentEntry) return { handled: true };
    return currentEntry.isDirectory
      ? { handled: true, toggleFolderPath: currentEntry.path }
      : { handled: true, activatePath: currentEntry.path };
  }

  if (key === " ") {
    return currentEntry?.isDirectory
      ? { handled: true, toggleFolderPath: currentEntry.path }
      : { handled: true };
  }

  if (key === "ArrowRight") {
    return currentEntry?.isDirectory && !openPaths.has(currentEntry.path)
      ? {
          handled: true,
          setFolderOpen: { path: currentEntry.path, open: true },
        }
      : { handled: true };
  }

  if (key === "ArrowLeft") {
    return currentEntry?.isDirectory && openPaths.has(currentEntry.path)
      ? {
          handled: true,
          setFolderOpen: { path: currentEntry.path, open: false },
        }
      : { handled: true };
  }

  return { handled: false };
}

interface UseFileTreeControllerProps {
  root: FileEntry | null;
  onSelect: (path: string) => void;
}

export interface FileTreeController {
  readonly openPaths: ReadonlySet<string>;
  readonly selectedPath: string | null;
  readonly visibleEntries: readonly FileEntry[];
  readonly setSelectedPath: React.Dispatch<React.SetStateAction<string | null>>;
  readonly toggleFolder: (path: string) => void;
  readonly setFolderOpen: (path: string, isOpen: boolean) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function useFileTreeController({
  root,
  onSelect,
}: UseFileTreeControllerProps): FileTreeController {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set());
  const children = root?.children ?? [];

  const visibleEntries = useMemo(
    () => flattenVisibleEntries(children, openPaths),
    [children, openPaths],
  );

  const toggleFolder = useCallback((path: string) => {
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const setFolderOpen = useCallback((path: string, isOpen: boolean) => {
    setOpenPaths((prev) => {
      if (isOpen && prev.has(path)) return prev;
      if (!isOpen && !prev.has(path)) return prev;

      const next = new Set(prev);
      if (isOpen) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (visibleEntries.length === 0) return;

    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT") return;

    const result = resolveFileTreeKey(
      event.key,
      visibleEntries,
      selectedPath,
      openPaths,
    );
    if (!result.handled) return;

    event.preventDefault();

    if (result.nextSelectedPath) {
      setSelectedPath(result.nextSelectedPath);
    }
    if (result.activatePath) {
      onSelect(result.activatePath);
    }
    if (result.toggleFolderPath) {
      toggleFolder(result.toggleFolderPath);
    }
    if (result.setFolderOpen) {
      setFolderOpen(result.setFolderOpen.path, result.setFolderOpen.open);
    }
  }, [onSelect, openPaths, selectedPath, setFolderOpen, toggleFolder, visibleEntries]);

  return {
    openPaths,
    selectedPath,
    visibleEntries,
    setSelectedPath,
    toggleFolder,
    setFolderOpen,
    handleKeyDown,
  };
}
