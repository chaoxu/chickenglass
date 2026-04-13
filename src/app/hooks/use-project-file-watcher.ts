import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { FileWatcher } from "../file-watcher";
import type { ExternalDocumentSyncResult } from "../editor-session-service";
import { isTauri } from "../../lib/tauri";

interface UseProjectFileWatcherOptions {
  projectRoot: string | null;
  containerRef: RefObject<HTMLElement | null>;
  refreshTree: (changedPath?: string) => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  syncExternalChange: (path: string) => Promise<ExternalDocumentSyncResult>;
}

export function useProjectFileWatcher({
  projectRoot,
  containerRef,
  refreshTree,
  reloadFile,
  syncExternalChange,
}: UseProjectFileWatcherOptions): void {
  const refreshTreeRef = useRef(refreshTree);
  const reloadFileRef = useRef(reloadFile);
  const syncExternalChangeRef = useRef(syncExternalChange);

  refreshTreeRef.current = refreshTree;
  reloadFileRef.current = reloadFile;
  syncExternalChangeRef.current = syncExternalChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!isTauri() || !projectRoot || !container) {
      return;
    }

    const watcher = new FileWatcher({
      refreshTree: (changedPath) => refreshTreeRef.current(changedPath),
      reloadFile: (path) => reloadFileRef.current(path),
      syncExternalChange: (path) => syncExternalChangeRef.current(path),
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
    projectRoot,
  ]);
}
