import { useEffect } from "react";
import { FileWatcher } from "../file-watcher";
import type { ExternalDocumentSyncResult } from "../editor-session-service";
import { isTauri } from "../../lib/tauri";

interface UseProjectFileWatcherOptions {
  projectRoot: string | null;
  refreshTree: (changedPath?: string) => Promise<void>;
  handleWatchedPathChange?: (path: string) => void | Promise<void>;
  syncExternalChange: (path: string) => Promise<ExternalDocumentSyncResult>;
}

export function useProjectFileWatcher({
  projectRoot,
  refreshTree,
  handleWatchedPathChange,
  syncExternalChange,
}: UseProjectFileWatcherOptions): void {
  useEffect(() => {
    if (!isTauri() || !projectRoot) {
      return;
    }

    const watcher = new FileWatcher({
      refreshTree,
      handleWatchedPathChange,
      syncExternalChange,
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
    handleWatchedPathChange,
    projectRoot,
    refreshTree,
    syncExternalChange,
  ]);
}
