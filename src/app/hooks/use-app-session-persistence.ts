import { useEffect, useRef } from "react";
import type { FileEntry } from "../file-manager";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";

interface AppSessionPersistenceDeps {
  fileTree: FileEntry | null;
  workspace: Pick<
    AppWorkspaceSessionController,
    "windowState" | "saveWindowState" | "sidebarCollapsed" | "sidebarWidth" | "setSidebarCollapsed" | "setSidebarWidth"
  >;
  editor: Pick<
    AppEditorShellController,
    "openTabs" | "activeTab" | "openFile" | "switchToTab" | "liveDocs" | "buffers" | "isPathOpen"
  >;
}

function findDefaultPath(fileTree: FileEntry): string | null {
  const rootFiles = (fileTree.children ?? []).filter((entry) => !entry.isDirectory);
  const preferred = rootFiles.find((entry) => entry.path === "main.md")
    ?? rootFiles.find((entry) => entry.path === "index.md")
    ?? rootFiles.find((entry) => entry.path.endsWith(".md"));

  const findFirst = (entry: FileEntry): string | null => {
    if (!entry.isDirectory) return entry.path;
    for (const child of entry.children ?? []) {
      const found = findFirst(child);
      if (found) return found;
    }
    return null;
  };

  return preferred?.path ?? findFirst(fileTree);
}

export function useAppSessionPersistence({
  fileTree,
  workspace,
  editor,
}: AppSessionPersistenceDeps): void {
  const didInitRef = useRef(false);
  const restorePromiseRef = useRef<Promise<void> | null>(null);
  const {
    windowState,
    saveWindowState,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth,
  } = workspace;
  const {
    openTabs,
    activeTab,
    openFile,
    switchToTab,
    isPathOpen,
  } = editor;

  useEffect(() => {
    if (!didInitRef.current) return;
    saveWindowState({
      tabs: openTabs.map((tab) => ({ path: tab.path, name: tab.name })),
      activeTab,
    });
  }, [activeTab, openTabs, saveWindowState]);

  useEffect(() => {
    if (!didInitRef.current) return;
    saveWindowState({
      sidebarWidth: sidebarCollapsed ? 0 : sidebarWidth,
    });
  }, [saveWindowState, sidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    if (didInitRef.current || restorePromiseRef.current || !fileTree) return;

    const restore = async () => {
      try {
        if (windowState.sidebarWidth === 0) {
          setSidebarCollapsed(true);
        } else if (windowState.sidebarWidth > 0) {
          setSidebarWidth(windowState.sidebarWidth);
        }

        if (windowState.tabs.length > 0) {
          await Promise.all(
            windowState.tabs.map((tab) =>
              openFile(tab.path).catch(() => {
                // File may have been deleted since last session — skip it.
              }),
            ),
          );

          if (windowState.activeTab) {
            // isPathOpen reads from the eagerly-updated sessionStateRef inside
            // useEditorSession, so it reflects the post-openFile state even
            // though React state hasn't re-rendered yet.
            if (isPathOpen(windowState.activeTab)) {
              switchToTab(windowState.activeTab);
            }
          }
        } else {
          const first = findDefaultPath(fileTree);
          if (first) {
            await openFile(first).catch(() => {
              // Default file may have disappeared between tree load and open.
            });
          }
        }
      } finally {
        didInitRef.current = true;
      }
    };

    restorePromiseRef.current = restore().finally(() => {
      restorePromiseRef.current = null;
    });
  }, [
    fileTree,
    openFile,
    isPathOpen,
    setSidebarCollapsed,
    setSidebarWidth,
    switchToTab,
    windowState.activeTab,
    windowState.sidebarWidth,
    windowState.tabs,
  ]);
}
