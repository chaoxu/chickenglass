import { useState, useCallback, useRef, useMemo } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ItemInstance } from "@headless-tree/core";
import type { FileEntry } from "../file-manager";
import { dirname } from "../lib/utils";
import { isTauri } from "../../lib/tauri";
import { useFileTreeContext } from "../contexts/file-tree-context";

type CreateKind = "file" | "folder";

export interface MenuItem {
  label: string;
  action?: () => void;
}

export const ICON_SIZE = 14;
export const ICON_CLASS = "shrink-0 text-[var(--cf-muted)]";

export interface UseTreeNodeRowArgs {
  item: ItemInstance<FileEntry>;
  /** Directory under which new items are created (dirname for files, entry.path for folders). */
  createParentPath: string;
  /** Called before creation starts (e.g. to expand a folder). */
  onBeforeCreate?: () => void;
}

export function useTreeNodeRow({ item, createParentPath, onBeforeCreate }: UseTreeNodeRowArgs) {
  const { activePath, gitStatus, onRename, onDelete, onCreateFile, onCreateDir } = useFileTreeContext();

  const entry = item.getItemData();
  const depth = item.getItemMeta().level;
  const indent = depth * 12 + 8;

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState<CreateKind | null>(null);

  const isActive = entry.path === activePath;
  const isFocused = item.isFocused();
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Keep onBeforeCreate in a ref so startCreate stays stable.
  const beforeCreateRef = useRef(onBeforeCreate);
  beforeCreateRef.current = onBeforeCreate;

  const restoreFocus = useCallback(() => {
    rowRef.current?.focus();
  }, []);

  const startRename = useCallback(() => {
    setRenameValue(entry.name);
    setRenaming(true);
  }, [entry.name]);

  const commitRename = useCallback(async () => {
    const newName = renameValue.trim();
    setRenaming(false);
    if (!newName || newName === entry.name) {
      restoreFocus();
      return;
    }
    const dir = dirname(entry.path);
    await onRename(entry.path, dir ? `${dir}/${newName}` : newName);
    restoreFocus();
  }, [entry.name, entry.path, onRename, renameValue, restoreFocus]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  const startCreate = useCallback(
    (kind: CreateKind) => {
      setCreating(kind);
      beforeCreateRef.current?.();
    },
    [],
  );

  const cancelCreate = useCallback(() => {
    setCreating(null);
  }, []);

  const rowProps = item.getProps();

  // Merge local rowRef with headless-tree's ref (item.registerElement) so
  // that updateDomFocus() can find DOM elements. Without this, the JSX
  // `ref={rowRef}` would silently override rowProps.ref (#462).
  const mergedRef = useMemo(() => {
    const htRef = rowProps.ref;
    return (el: HTMLDivElement | null) => {
      rowRef.current = el;
      if (typeof htRef === "function") htRef(el);
      else if (htRef && typeof htRef === "object")
        (htRef as React.RefObject<HTMLDivElement | null>).current = el;
    };
  }, [rowProps.ref]);

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    rowProps.onClick?.(event.nativeEvent);
  };

  const handleContextSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    item.setFocused();
  };

  const handleRowKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "F2") {
        event.preventDefault();
        startRename();
      }
    },
    [startRename],
  );

  const handleCreateConfirm = (name: string) => {
    const fullPath = createParentPath ? `${createParentPath}/${name}` : name;
    if (creating === "folder") {
      onCreateDir(fullPath);
    } else {
      onCreateFile(fullPath);
    }
    setCreating(null);
  };

  const revealItem: MenuItem | null = isTauri()
    ? {
        label: "Reveal in Finder",
        action: () => {
          void import("../tauri-fs").then(({ revealInFinder }) =>
            revealInFinder(entry.path),
          ).catch((e: unknown) => {
            console.error("[file-tree] revealInFinder failed:", e);
          });
        },
      }
    : null;

  const deleteAction = () => {
    void onDelete(entry.path).then(restoreFocus).catch((e: unknown) => {
      console.error("[file-tree] delete failed:", e);
    });
  };

  const copyNameAction = () => {
    void navigator.clipboard.writeText(entry.name).catch((e: unknown) => {
      console.error("[file-tree] clipboard write failed:", e);
    });
  };

  return {
    entry,
    depth,
    indent,
    renaming,
    renameValue,
    setRenameValue,
    creating,
    isActive,
    isFocused,
    mergedRef,
    rowProps,
    gitStatus,
    startRename,
    commitRename,
    cancelRename,
    startCreate,
    cancelCreate,
    handleCreateConfirm,
    handleClick,
    handleContextSelection,
    handleRowKey,
    revealItem,
    deleteAction,
    copyNameAction,
  };
}
