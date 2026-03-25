import { useEffect } from "react";
import type { RefObject } from "react";
import { FileWatcher } from "../file-watcher";
import { isTauri } from "../tauri-fs";

let latestWatcherEffectId = 0;

interface UseProjectFileWatcherOptions {
  projectRoot: string | null;
  containerRef: RefObject<HTMLElement | null>;
  isPathOpen: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
  reloadFile: (path: string) => Promise<void>;
}

export function useProjectFileWatcher({
  projectRoot,
  containerRef,
  isPathOpen,
  isPathDirty,
  reloadFile,
}: UseProjectFileWatcherOptions): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!isTauri() || !projectRoot || !container) {
      return;
    }

    const watcher = new FileWatcher({
      isFileOpen: isPathOpen,
      isFileDirty: isPathDirty,
      reloadFile,
      container,
    });
    let cancelled = false;
    const effectId = ++latestWatcherEffectId;

    const stopWatcher = () => watcher.unwatch().catch((e: unknown) => {
      console.error("[file-watcher] failed to stop watcher", e);
    });

    void watcher.watch(projectRoot)
      .then(() => {
        if (cancelled && latestWatcherEffectId === effectId) {
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
  }, [containerRef, isPathDirty, isPathOpen, projectRoot, reloadFile]);
}
