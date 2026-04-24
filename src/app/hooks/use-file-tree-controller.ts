import {
  hotkeysCoreFeature,
  type ItemInstance,
  propMemoizationFeature,
  syncDataLoaderFeature,
  type TreeConfig,
  type TreeInstance,
  type TreeState,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildFileTreeIndex,
  FILE_TREE_ROOT_ITEM_ID,
  type FileTreeIndex,
} from "../../lib/file-tree-model";
import type { FileEntry } from "../file-manager";

const ROOT_ITEM_ID = FILE_TREE_ROOT_ITEM_ID;

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

export { flattenVisibleFileEntries as flattenVisibleEntries } from "../../lib/file-tree-model";

/** Legacy helper retained for compatibility with #284 tests and pure callers. */
export function resolveFileTreeKey(
  key: string,
  visibleEntries: readonly FileEntry[],
  selectedPath: string | null,
  openPaths: ReadonlySet<string>,
): FileTreeKeyResult {
  if (visibleEntries.length === 0) return { handled: false };

  const currentIndex = selectedPath
    ? visibleEntries.findIndex((entry) => entry.path === selectedPath)
    : -1;
  const currentEntry = currentIndex >= 0 ? visibleEntries[currentIndex] : null;

  if (key === "ArrowDown") {
    const target = currentIndex === -1
      ? visibleEntries[0]
      : visibleEntries[currentIndex + 1];
    return target
      ? {
          handled: true,
          nextSelectedPath: target.path,
          activatePath: target.isDirectory ? undefined : target.path,
        }
      : { handled: true };
  }

  if (key === "ArrowUp") {
    const target = currentIndex === -1
      ? visibleEntries[visibleEntries.length - 1]
      : visibleEntries[currentIndex - 1];
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
      ? { handled: true, setFolderOpen: { path: currentEntry.path, open: true } }
      : { handled: true };
  }

  if (key === "ArrowLeft") {
    return currentEntry?.isDirectory && openPaths.has(currentEntry.path)
      ? { handled: true, setFolderOpen: { path: currentEntry.path, open: false } }
      : { handled: true };
  }

  return { handled: false };
}

export { buildFileTreeIndex as buildTreeIndex } from "../../lib/file-tree-model";

function getIndexedEntry(
  index: FileTreeIndex,
  itemId: string,
): FileEntry {
  return index.entriesById.get(itemId)
    ?? index.entriesById.get(ROOT_ITEM_ID)
    ?? {
      name: "root",
      path: "",
      isDirectory: true,
      children: [],
    };
}

function getFocusedItemOrNull(
  tree: TreeInstance<FileEntry>,
): ItemInstance<FileEntry> | null {
  const focusedItemId = tree.getState().focusedItem;
  return focusedItemId !== null
    ? tree.getItemInstance(focusedItemId)
    : null;
}

function focusVisibleItem(
  item: ItemInstance<FileEntry> | undefined,
  onSelect: (path: string) => void,
) {
  if (!item) return;
  item.setFocused();
  item.getTree().updateDomFocus();
  if (!item.isFolder()) {
    onSelect(item.getId());
  }
}

export function createFileTreeHotkeys(
  onSelect: (path: string) => void,
): NonNullable<TreeConfig<FileEntry>["hotkeys"]> {
  return {
    focusNextItem: {
      hotkey: "ArrowDown",
      canRepeat: true,
      preventDefault: true,
      handler: (_event, currentTree) => {
        const focused = getFocusedItemOrNull(currentTree);
        if (!focused) {
          focusVisibleItem(currentTree.getItems()[0], onSelect);
          return;
        }
        currentTree.focusNextItem();
        currentTree.updateDomFocus();
        const nextFocused = getFocusedItemOrNull(currentTree);
        if (nextFocused && !nextFocused.isFolder()) {
          onSelect(nextFocused.getId());
        }
      },
    },
    focusPreviousItem: {
      hotkey: "ArrowUp",
      canRepeat: true,
      preventDefault: true,
      handler: (_event, currentTree) => {
        const focused = getFocusedItemOrNull(currentTree);
        if (!focused) {
          focusVisibleItem(
            currentTree.getItems()[currentTree.getItems().length - 1],
            onSelect,
          );
          return;
        }
        currentTree.focusPreviousItem();
        currentTree.updateDomFocus();
        const previousFocused = getFocusedItemOrNull(currentTree);
        if (previousFocused && !previousFocused.isFolder()) {
          onSelect(previousFocused.getId());
        }
      },
    },
    expandOrDown: {
      hotkey: "ArrowRight",
      canRepeat: true,
      preventDefault: true,
      handler: (_event, currentTree) => {
        const focused = getFocusedItemOrNull(currentTree);
        if (focused?.isFolder() && !focused.isExpanded()) {
          focused.expand();
        }
      },
    },
    collapseOrUp: {
      hotkey: "ArrowLeft",
      canRepeat: true,
      preventDefault: true,
      handler: (_event, currentTree) => {
        const focused = getFocusedItemOrNull(currentTree);
        if (focused?.isFolder() && focused.isExpanded()) {
          focused.collapse();
        }
      },
    },
    customActivateFocusedItem: {
      hotkey: "Enter",
      preventDefault: true,
      handler: (_event, currentTree) => {
        const focused = getFocusedItemOrNull(currentTree);
        if (!focused) return;
        if (focused.isFolder()) {
          if (focused.isExpanded()) {
            focused.collapse();
          } else {
            focused.expand();
          }
          return;
        }
        onSelect(focused.getId());
      },
    },
    customToggleFocusedFolder: {
      hotkey: "Space",
      preventDefault: true,
      handler: (_event, currentTree) => {
        const focused = getFocusedItemOrNull(currentTree);
        if (!focused?.isFolder()) return;
        if (focused.isExpanded()) {
          focused.collapse();
        } else {
          focused.expand();
        }
      },
    },
  };
}

/**
 * Holds file tree UI state that must survive unmount/remount cycles
 * (e.g. when switching sidebar tabs). Created once in a parent that
 * does not unmount and passed into `useFileTreeController`.
 */
export interface PersistentTreeState {
  readonly treeState: Partial<TreeState<FileEntry>>;
  readonly scrollTop: number;
}

const DEFAULT_PERSISTENT_STATE: PersistentTreeState = {
  treeState: { expandedItems: [], focusedItem: null },
  scrollTop: 0,
};

/**
 * Create a ref that holds persistent file tree state across
 * unmount/remount cycles. Call once in a component that never unmounts.
 */
export function usePersistentTreeState(): React.RefObject<PersistentTreeState> {
  return useRef<PersistentTreeState>(DEFAULT_PERSISTENT_STATE);
}

interface UseFileTreeControllerProps {
  root: FileEntry | null;
  onSelect: (path: string) => void;
  /** When provided, tree state survives unmount/remount (tab switches). */
  persistRef?: React.RefObject<PersistentTreeState>;
  /** Load children for a directory on expand (lazy tree loading). */
  onLoadChildren?: (dirPath: string) => void;
}

interface FileTreeController {
  readonly tree: TreeInstance<FileEntry>;
  readonly visibleItems: readonly ItemInstance<FileEntry>[];
  /** Save current scroll position — call before unmount. */
  readonly saveScrollPosition: (scrollTop: number) => void;
  /** The scroll position to restore on mount. */
  readonly savedScrollTop: number;
}

export function useFileTreeController({
  root,
  onSelect,
  persistRef,
  onLoadChildren,
}: UseFileTreeControllerProps): FileTreeController {
  const index = useMemo(() => buildFileTreeIndex(root), [root]);
  const onSelectRef = useRef(onSelect);
  const [state, setState] = useState<Partial<TreeState<FileEntry>>>(
    () => persistRef?.current.treeState ?? { expandedItems: [], focusedItem: null },
  );

  onSelectRef.current = onSelect;

  // Sync state back to the persist ref on every change so it survives unmount.
  useEffect(() => {
    if (persistRef) {
      persistRef.current = { ...persistRef.current, treeState: state };
    }
  }, [persistRef, state]);

  useEffect(() => {
    setState((prev) => ({
      ...prev,
      expandedItems: (prev.expandedItems ?? []).filter((id) => index.entriesById.has(id)),
      focusedItem:
        prev.focusedItem && index.entriesById.has(prev.focusedItem)
          ? prev.focusedItem
          : null,
    }));
  }, [index]);

  // Trigger lazy loading when a directory is expanded but has no children loaded.
  // Checks ALL expanded items (not just newly expanded ones) so that a tree
  // refresh that resets children to undefined triggers a reload.
  useEffect(() => {
    if (!onLoadChildren) return;
    for (const id of state.expandedItems ?? []) {
      const entry = index.entriesById.get(id);
      if (entry?.isDirectory && entry.children === undefined) {
        onLoadChildren(id);
      }
    }
  }, [state.expandedItems, index, onLoadChildren]);

  // Keep headless-tree callbacks stable while still dispatching to the latest
  // FileTree prop handler from the current render.
  const handleSelect = useCallback((path: string) => {
    onSelectRef.current(path);
  }, []);

  const handlePrimaryAction = useCallback((item: ItemInstance<FileEntry>) => {
    if (!item.isFolder()) {
      handleSelect(item.getId());
    }
  }, [handleSelect]);

  const hotkeys = useMemo(
    () => createFileTreeHotkeys(handleSelect),
    [handleSelect],
  );

  const tree = useTree<FileEntry>({
    rootItemId: ROOT_ITEM_ID,
    state,
    setState,
    indent: 12,
    ignoreHotkeysOnInputs: true,
    dataLoader: {
      getItem: (itemId) => getIndexedEntry(index, itemId),
      getChildren: (itemId) => index.childrenById.get(itemId) ?? [],
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().isDirectory,
    onPrimaryAction: handlePrimaryAction,
    hotkeys,
    features: [
      syncDataLoaderFeature,
      hotkeysCoreFeature,
      propMemoizationFeature,
    ],
  });

  const visibleItems = tree.getItems().filter((item) => item.getId() !== ROOT_ITEM_ID);

  const saveScrollPosition = useCallback(
    (scrollTop: number) => {
      if (persistRef) {
        persistRef.current = { ...persistRef.current, scrollTop };
      }
    },
    [persistRef],
  );

  const savedScrollTop = persistRef?.current.scrollTop ?? 0;

  return {
    tree,
    visibleItems,
    saveScrollPosition,
    savedScrollTop,
  };
}
