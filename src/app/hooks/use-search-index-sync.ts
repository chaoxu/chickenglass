import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundIndexer, IndexFileSnapshot } from "../../index";
import type { FileSystem } from "../file-manager";
import { measureAsync } from "../perf";
import { collectSearchableMarkdownPaths } from "../search";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";

const ACTIVE_SEARCH_REINDEX_DEBOUNCE_MS = 120;
const ACTIVE_SEARCH_REINDEX_IDLE_TIMEOUT_MS = 1_000;
const SEARCH_INDEX_FILE_READ_CONCURRENCY = 8;
const SEARCH_INDEX_BULK_UPDATE_BATCH_SIZE = 25;

type IdleTaskHandle = number;
type IdleTaskDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};
type WindowWithIdleTask = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleTaskDeadline) => void,
    options?: { readonly timeout?: number },
  ) => IdleTaskHandle;
  cancelIdleCallback?: (handle: IdleTaskHandle) => void;
};
type EditorViewSnapshot = NonNullable<AppEditorShellController["editorState"]>["view"];

interface ActiveSearchSnapshot {
  readonly doc: string;
  readonly path: string | null;
  readonly view: EditorViewSnapshot | null;
}

interface SearchIndexSyncDeps {
  readonly fs: FileSystem;
  readonly searchOpen: boolean;
  readonly fileTree: AppWorkspaceSessionController["fileTree"];
  readonly editor: Pick<
    AppEditorShellController,
    "activeDocumentSignal" | "currentPath" | "editorState" | "getCurrentDocText"
  >;
}

export interface SearchIndexSyncController {
  readonly indexer: BackgroundIndexer | null;
  readonly searchVersion: number;
}

function sameActiveSearchSnapshot(
  left: ActiveSearchSnapshot,
  right: ActiveSearchSnapshot,
): boolean {
  return left.path === right.path && left.doc === right.doc && left.view === right.view;
}

function isStaleActiveSearchSnapshot(
  snapshot: ActiveSearchSnapshot,
  latestSnapshotRef: { readonly current: ActiveSearchSnapshot },
): boolean {
  return !sameActiveSearchSnapshot(snapshot, latestSnapshotRef.current);
}

function scheduleDebouncedIdleTask(
  task: () => void,
): () => void {
  let idleHandle: IdleTaskHandle | null = null;
  const timeoutHandle = window.setTimeout(() => {
    const idleWindow = window as WindowWithIdleTask;
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(() => {
        idleHandle = null;
        task();
      }, { timeout: ACTIVE_SEARCH_REINDEX_IDLE_TIMEOUT_MS });
      return;
    }
    task();
  }, ACTIVE_SEARCH_REINDEX_DEBOUNCE_MS);

  return () => {
    window.clearTimeout(timeoutHandle);
    if (idleHandle !== null) {
      const idleWindow = window as WindowWithIdleTask;
      idleWindow.cancelIdleCallback?.(idleHandle);
    }
  };
}

function yieldSearchIndexBatch(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

async function readActiveDocumentAnalysis(
  view: EditorViewSnapshot | null | undefined,
): Promise<IndexFileSnapshot["analysis"] | undefined> {
  if (!view) {
    return undefined;
  }
  const { documentAnalysisField } = await import("../../state/document-analysis");
  return view.state.field(documentAnalysisField, false);
}

async function readSearchIndexFiles({
  fs,
  paths,
  currentPath,
  activeSearchDoc,
  activeSearchAnalysis,
  isCancelled,
}: {
  readonly fs: FileSystem;
  readonly paths: readonly string[];
  readonly currentPath: string | null;
  readonly activeSearchDoc: string;
  readonly activeSearchAnalysis: IndexFileSnapshot["analysis"] | undefined;
  readonly isCancelled: () => boolean;
}): Promise<IndexFileSnapshot[] | null> {
  const files = new Array<IndexFileSnapshot>(paths.length);
  let nextIndex = 0;

  async function readWorker(): Promise<void> {
    while (!isCancelled()) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= paths.length) {
        return;
      }

      const path = paths[index];
      files[index] = path === currentPath
        ? {
            file: path,
            content: activeSearchDoc,
            analysis: activeSearchAnalysis,
          }
        : {
            file: path,
            content: await fs.readFile(path),
          };
    }
  }

  const workerCount = Math.min(SEARCH_INDEX_FILE_READ_CONCURRENCY, paths.length);
  await Promise.all(Array.from({ length: workerCount }, () => readWorker()));
  return isCancelled() ? null : files;
}

export function useSearchIndexSync({
  fs,
  searchOpen,
  fileTree,
  editor,
}: SearchIndexSyncDeps): SearchIndexSyncController {
  const indexerRef = useRef<BackgroundIndexer | null>(null);
  const indexerImportRef = useRef<Promise<BackgroundIndexer> | null>(null);
  const [indexer, setIndexer] = useState<BackgroundIndexer | null>(null);
  const [searchSyncRevision, setSearchSyncRevision] = useState(0);
  const [searchVersion, setSearchVersion] = useState(0);
  const activeSearchView = editor.editorState?.view ?? null;
  const activeSearchDoc = useMemo(
    () => (
      searchOpen && editor.currentPath
        ? editor.getCurrentDocText()
        : ""
    ),
    [searchOpen, editor.currentPath, editor.getCurrentDocText],
  );
  const activeSearchSnapshot: ActiveSearchSnapshot = {
    path: editor.currentPath,
    doc: activeSearchDoc,
    view: activeSearchView,
  };
  const latestActiveSearchSnapshotRef = useRef<ActiveSearchSnapshot>(activeSearchSnapshot);
  latestActiveSearchSnapshotRef.current = activeSearchSnapshot;
  const latestEditorSnapshotRef = useRef({
    currentPath: editor.currentPath,
    getCurrentDocText: editor.getCurrentDocText,
    view: activeSearchView,
  });
  latestEditorSnapshotRef.current = {
    currentPath: editor.currentPath,
    getCurrentDocText: editor.getCurrentDocText,
    view: activeSearchView,
  };

  const readStableActiveDocumentAnalysis = useCallback(async (
    snapshot: ActiveSearchSnapshot,
  ): Promise<{ analysis: IndexFileSnapshot["analysis"] | undefined; stale: boolean }> => {
    const analysis = await readActiveDocumentAnalysis(snapshot.view);
    const latestSnapshot = latestActiveSearchSnapshotRef.current;
    if (!sameActiveSearchSnapshot(snapshot, latestSnapshot)) {
      return { analysis: undefined, stale: true };
    }
    return { analysis, stale: false };
  }, []);

  const ensureIndexer = useCallback(async (): Promise<BackgroundIndexer> => {
    if (indexerRef.current) {
      return indexerRef.current;
    }
    if (!indexerImportRef.current) {
      indexerImportRef.current = import("../../index").then((module) => {
        const nextIndexer = new module.BackgroundIndexer();
        indexerRef.current = nextIndexer;
        setIndexer(nextIndexer);
        return nextIndexer;
      });
    }
    return indexerImportRef.current;
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      setSearchSyncRevision(0);
      return;
    }

    return editor.activeDocumentSignal.subscribe(() => {
      setSearchSyncRevision((revision) => revision + 1);
    });
  }, [searchOpen, editor.activeDocumentSignal]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const tree = await fs.listTree();
        const markdownPaths = collectSearchableMarkdownPaths(tree);
        const searchablePathSet = new Set(markdownPaths);
        const activeIndexer = await ensureIndexer();
        const startingActiveSnapshot = latestActiveSearchSnapshotRef.current;
        const activeSearchAnalysis = (
          await readStableActiveDocumentAnalysis(startingActiveSnapshot)
        ).analysis;
        const files = await readSearchIndexFiles({
          fs,
          paths: markdownPaths,
          currentPath: startingActiveSnapshot.path,
          activeSearchDoc: startingActiveSnapshot.doc,
          activeSearchAnalysis,
          isCancelled: () => cancelled,
        });

        if (files === null) {
          return;
        }

        if (!cancelled) {
          const indexedEntries = await measureAsync(
            "search.index.bulkUpdate",
            () => activeIndexer.bulkUpdateChunked(files, {
              batchSize: SEARCH_INDEX_BULK_UPDATE_BATCH_SIZE,
              shouldCancel: () => cancelled,
              yieldAfterBatch: yieldSearchIndexBatch,
            }),
            {
              category: "search",
              detail: `${files.length} files`,
            },
          );
          if (indexedEntries === null || cancelled) {
            return;
          }

          const latestEditorSnapshot = latestEditorSnapshotRef.current;
          const latestCurrentPath = latestEditorSnapshot.currentPath;
          if (
            latestCurrentPath !== null &&
            searchablePathSet.has(latestCurrentPath)
          ) {
            const latestActiveSearchSnapshot: ActiveSearchSnapshot = {
              path: latestCurrentPath,
              doc: latestEditorSnapshot.getCurrentDocText(),
              view: latestEditorSnapshot.view,
            };
            latestActiveSearchSnapshotRef.current = latestActiveSearchSnapshot;
            const latestAnalysisResult = await readStableActiveDocumentAnalysis(
              latestActiveSearchSnapshot,
            );
            if (latestAnalysisResult.stale || cancelled) {
              return;
            }
            const updatedEntries = await activeIndexer.updateFileDeferred(
              latestCurrentPath,
              latestActiveSearchSnapshot.doc,
              latestAnalysisResult.analysis,
              {
                shouldCancel: () => (
                  cancelled
                  || isStaleActiveSearchSnapshot(
                    latestActiveSearchSnapshot,
                    latestActiveSearchSnapshotRef,
                  )
                ),
              },
            );
            if (updatedEntries === null) {
              return;
            }
          }
          setSearchVersion((version) => version + 1);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          console.error("[search] failed to build app search index", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    searchOpen,
    fileTree,
    fs,
    ensureIndexer,
    activeSearchView,
    readStableActiveDocumentAnalysis,
  ]);

  useEffect(() => {
    if (
      !searchOpen ||
      searchSyncRevision === 0 ||
      !editor.currentPath?.endsWith(".md")
    ) {
      return;
    }

    const currentPath = editor.currentPath;
    let cancelled = false;
    const cancelScheduledSync = scheduleDebouncedIdleTask(() => {
      void measureAsync(
        "search.index.updateFile",
        async () => {
          const latestEditorSnapshot = latestEditorSnapshotRef.current;
          if (latestEditorSnapshot.currentPath !== currentPath) {
            return null;
          }
          const syncSnapshot: ActiveSearchSnapshot = {
            path: currentPath,
            doc: latestEditorSnapshot.getCurrentDocText(),
            view: latestEditorSnapshot.view,
          };
          latestActiveSearchSnapshotRef.current = syncSnapshot;
          const activeIndexer = await ensureIndexer();
          const activeSearchAnalysis = await readStableActiveDocumentAnalysis(syncSnapshot);
          if (activeSearchAnalysis.stale) {
            return null;
          }
          return activeIndexer.updateFileDeferred(
            currentPath,
            syncSnapshot.doc,
            activeSearchAnalysis.analysis,
            {
              shouldCancel: () => (
                cancelled
                || isStaleActiveSearchSnapshot(syncSnapshot, latestActiveSearchSnapshotRef)
              ),
            },
          );
        },
        {
          category: "search",
          detail: currentPath,
        },
      )
        .then((updatedEntries) => {
          if (!cancelled && updatedEntries !== null) {
            setSearchVersion((version) => version + 1);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            console.error("[search] failed to sync active file into app search index", error);
          }
        });
    });

    return () => {
      cancelled = true;
      cancelScheduledSync();
    };
  }, [
    searchOpen,
    ensureIndexer,
    editor.currentPath,
    readStableActiveDocumentAnalysis,
    searchSyncRevision,
  ]);

  return {
    indexer,
    searchVersion,
  };
}
