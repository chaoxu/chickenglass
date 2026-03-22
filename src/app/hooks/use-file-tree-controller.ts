import { useEffect, useMemo, useState } from "react";
import {
  hotkeysCoreFeature,
  syncDataLoaderFeature,
  type ItemInstance,
  type TreeConfig,
  type TreeInstance,
  type TreeState,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { FileEntry } from "../file-manager";

const ROOT_ITEM_ID = "__cf-file-tree-root__";

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

/** Legacy helper retained for compatibility with #284 tests and pure callers. */
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

function buildTreeIndex(root: FileEntry | null): {
  readonly entriesById: Map<string, FileEntry>;
  readonly childrenById: Map<string, string[]>;
} {
  const entriesById = new Map<string, FileEntry>();
  const childrenById = new Map<string, string[]>();

  const syntheticRoot: FileEntry = root ?? {
    name: "root",
    path: "",
    isDirectory: true,
    children: [],
  };

  entriesById.set(ROOT_ITEM_ID, syntheticRoot);
  childrenById.set(
    ROOT_ITEM_ID,
    syntheticRoot.children?.map((entry) => entry.path) ?? [],
  );

  const visit = (entry: FileEntry) => {
    entriesById.set(entry.path, entry);
    childrenById.set(
      entry.path,
      entry.isDirectory ? entry.children?.map((child) => child.path) ?? [] : [],
    );
    entry.children?.forEach(visit);
  };

  syntheticRoot.children?.forEach(visit);

  return { entriesById, childrenById };
}

function getIndexedEntry(
  index: ReturnType<typeof buildTreeIndex>,
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

interface UseFileTreeControllerProps {
  root: FileEntry | null;
  onSelect: (path: string) => void;
}

interface FileTreeController {
  readonly tree: TreeInstance<FileEntry>;
  readonly visibleItems: readonly ItemInstance<FileEntry>[];
}

export function useFileTreeController({
  root,
  onSelect,
}: UseFileTreeControllerProps): FileTreeController {
  const index = useMemo(() => buildTreeIndex(root), [root]);
  const [state, setState] = useState<Partial<TreeState<FileEntry>>>({
    expandedItems: [],
    focusedItem: null,
  });

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
    onPrimaryAction: (item) => {
      if (!item.isFolder()) {
        onSelect(item.getId());
      }
    },
    hotkeys: createFileTreeHotkeys(onSelect),
    features: [
      syncDataLoaderFeature,
      hotkeysCoreFeature,
    ],
  });

  const visibleItems = tree.getItems().filter((item) => item.getId() !== ROOT_ITEM_ID);

  return {
    tree,
    visibleItems,
  };
}
