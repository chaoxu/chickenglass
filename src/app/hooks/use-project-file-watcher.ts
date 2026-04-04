import { useEffect } from "react";
import type { RefObject } from "react";
import { FileWatcher } from "../file-watcher";
import { isTauri } from "../../lib/tauri";

interface UseProjectFileWatcherOptions {
  projectRoot: string | null;
  containerRef: RefObject<HTMLElement | null>;
  isPathOpen: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
  refreshTree: (changedPath?: string) => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  handleWatchedPathChange?: (path: string) => void | Promise<void>;
  isSelfChange?: (path: string) => Promise<boolean>;
}

export function useProjectFileWatcher({
  projectRoot,
  containerRef,
  isPathOpen,
  isPathDirty,
  refreshTree,
  reloadFile,
  handleWatchedPathChange,
  isSelfChange,
}: UseProjectFileWatcherOptions): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!isTauri() || !projectRoot || !container) {
      return;
    }

    const watcher = new FileWatcher({
      isFileOpen: isPathOpen,
      isFileDirty: isPathDirty,
      refreshTree,
      reloadFile,
      handleWatchedPathChange,
      isSelfChange,
      container,
    });
    let cancelled = false;

    const stopWatcher = () => watcher.unwatch().catch((e: unknown) => {
      console.error("[file-watcher] failed to stop watcher", e);
    });

    void watcher.watch(projectRoot)
      .then(() => {
        if (cancelled) {
          void stopWatcher();
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error("[file-watcher] failed to start watcher", e);
        }
      });

    return () => {
      cancelled = true;
      void stopWatcher();
    };
  }, [
    containerRef,
    handleWatchedPathChange,
    isPathDirty,
    isPathOpen,
    isSelfChange,
    projectRoot,
    refreshTree,
    reloadFile,
  ]);
}
