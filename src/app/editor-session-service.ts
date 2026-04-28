import { basename, dirname } from "./lib/utils";
import {
  clearExternalDocumentConflict,
  clearSessionDocument,
  setCurrentSessionDocument,
  setExternalDocumentConflict,
} from "./editor-session-actions";
import {
  type SessionDocument,
} from "./editor-session-model";
import type { FileSystem } from "./file-manager";
import { measureAsync, withPerfOperation } from "./perf";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "./unsaved-changes";
import {
  applyEditorDocumentChanges,
  createMinimalEditorDocumentChanges,
  createEditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
  type EditorDocumentChange,
} from "./editor-doc-change";
import { createExternalConflictMergeDocument } from "./external-conflict-merge";
import {
  documentForPath,
  documentTextForPath,
  type EditorSessionRuntime,
} from "./editor-session-runtime";

export type ExternalDocumentSyncResult = "ignore" | "notify" | "reloaded" | "self-change";

export interface EditorSessionService {
  getCurrentDocText: () => string;
  isPathOpen: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
  cancelPendingOpenFile: () => void;
  handleDocChange: (changes: readonly EditorDocumentChange[]) => void;
  handleDocumentSnapshot: (doc: string) => void;
  markCurrentDocumentDirty: () => void;
  handleProgrammaticDocChange: (path: string, doc: string) => void;
  prepareCurrentDocumentForTransition: (
    reason: UnsavedChangesRequest["reason"],
    target?: { path?: string; name: string },
    options?: { promptOnSwitchFile?: boolean },
  ) => Promise<boolean>;
  openFile: (path: string) => Promise<void>;
  openFileWithContent: (name: string, content: string) => Promise<void>;
  restoreDocumentFromRecovery: (
    path: string,
    content: string,
    options?: { baselineHash?: string },
  ) => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  syncExternalChange: (path: string) => Promise<ExternalDocumentSyncResult>;
  keepExternalConflict: (path: string) => Promise<void>;
  mergeExternalConflict: (path: string) => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  closeCurrentFile: (options?: { discard?: boolean }) => Promise<boolean>;
  handleWindowCloseRequest: () => Promise<boolean>;
}

export interface EditorSessionServiceOptions {
  fs: FileSystem;
  refreshTree: (changedPath?: string) => Promise<void>;
  addRecentFile: (path: string) => void;
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
  runtime: EditorSessionRuntime;
  onAfterDiscard?: (path: string) => void | Promise<void>;
  saveCurrentDocument: () => Promise<boolean>;
}

function makeTransitionRequest(
  currentDocument: SessionDocument,
  reason: UnsavedChangesRequest["reason"],
  target?: { path?: string; name: string },
): UnsavedChangesRequest {
  return {
    reason,
    currentDocument: {
      path: currentDocument.path,
      name: currentDocument.name,
    },
    target,
  };
}

function pathAffectsDocument(changedPath: string, documentPath: string): boolean {
  return documentPath === changedPath || (
    changedPath !== "" && documentPath.startsWith(`${changedPath}/`)
  );
}

export function createEditorSessionService({
  fs,
  refreshTree,
  addRecentFile,
  requestUnsavedChangesDecision,
  runtime,
  onAfterDiscard,
  saveCurrentDocument,
}: EditorSessionServiceOptions): EditorSessionService {
  const notifyAfterDiscard = (path: string) => {
    if (!onAfterDiscard) {
      return;
    }
    void Promise.resolve().then(() => onAfterDiscard(path)).catch((error: unknown) => {
      console.error("[session] after-discard callback failed:", error);
    });
  };

  const clearPathBuffers = (path: string) => {
    runtime.pipeline.clear(path);
    runtime.buffers.delete(path);
    runtime.liveDocs.delete(path);
    runtime.forgetPath(path);
    runtime.clearExternalConflictBaseline(path);
    runtime.clearNewDocumentPath(path);
    runtime.commit(clearExternalDocumentConflict(runtime.getState(), path));
  };

  const applyReloadedDocument = (path: string, content: string) => {
    if (!runtime.hasPath(path)) {
      return false;
    }

    const documentText = createEditorDocumentText(content);
    clearPathBuffers(path);
    runtime.buffers.set(path, documentText);
    runtime.liveDocs.set(path, documentText);
    runtime.pipeline.initPath(path, content);
    runtime.commit(
      clearExternalDocumentConflict(
        runtime.setPathDirty(path, false),
        path,
      ),
      runtime.getCurrentPath() === path
        ? { editorDoc: content }
        : undefined,
    );
    return true;
  };

  const discardDocumentChanges = (path: string) => {
    const savedDoc = runtime.buffers.get(path) ?? emptyEditorDocument;
    runtime.liveDocs.set(path, savedDoc);
    runtime.commit(
      runtime.setPathDirty(path, false),
      runtime.getCurrentPath() === path
        ? { editorDoc: editorDocumentToString(savedDoc) }
        : undefined,
    );
    notifyAfterDiscard(path);
  };

  const prepareCurrentDocumentForTransition = async (
    reason: UnsavedChangesRequest["reason"],
    target?: { path?: string; name: string },
    options?: { promptOnSwitchFile?: boolean },
  ): Promise<boolean> => {
    const currentDocument = runtime.getCurrentDocument();
    if (!currentDocument || !runtime.isPathDirty(currentDocument.path)) {
      return true;
    }

    if (reason === "switch-file" && options?.promptOnSwitchFile !== true) {
      return true;
    }

    const decision = await requestUnsavedChangesDecision(
      makeTransitionRequest(currentDocument, reason, target),
    );

    if (decision === "cancel") {
      return false;
    }

    if (decision === "save") {
      return saveCurrentDocument();
    }

    discardDocumentChanges(currentDocument.path);
    return true;
  };

  const getCurrentDocText = (): string =>
    documentForPath(runtime.getCurrentPath(), runtime.liveDocs, runtime.buffers);

  const isPathOpen = (path: string): boolean => runtime.hasPath(path);

  const isPathDirty = (path: string): boolean => runtime.isPathDirty(path);

  const keepExternalConflict = async (path: string): Promise<void> => {
    const conflict = runtime.getState().externalConflict;
    if (conflict?.path !== path) {
      return;
    }

    if (conflict.kind === "modified") {
      try {
        const diskDoc = runtime.externalConflictBaselines.get(path)
          ?? createEditorDocumentText(await fs.readFile(path));
        const diskContent = editorDocumentToString(diskDoc);
        const liveDoc = runtime.liveDocs.get(path) ?? diskDoc;
        runtime.buffers.set(path, diskDoc);
        runtime.clearExternalConflictBaseline(path);
        runtime.clearNewDocumentPath(path);
        runtime.pipeline.initPath(path, diskContent);
        runtime.commit(
          clearExternalDocumentConflict(
            runtime.setPathDirty(path, !liveDoc.eq(diskDoc)),
            path,
          ),
        );
        return;
      } catch (_error: unknown) {
        // If the external baseline can no longer be read, treat the conflict as a deletion.
        runtime.commit(setExternalDocumentConflict(runtime.getState(), {
          kind: "deleted",
          path,
        }));
        return;
      }
    }

    const startRevision = runtime.pipeline.getRevision(path);
    const liveDoc = runtime.liveDocs.get(path) ?? emptyEditorDocument;
    const content = editorDocumentToString(liveDoc);
    try {
      if (await fs.exists(path)) {
        const diskContent = await fs.readFile(path);
        runtime.setExternalConflictBaseline(path, createEditorDocumentText(diskContent));
        runtime.commit(setExternalDocumentConflict(runtime.getState(), {
          kind: "modified",
          path,
        }));
        return;
      }
      await fs.createFile(path, content);
      const savedDoc = createEditorDocumentText(content);
      const revisionAdvanced = runtime.pipeline.getRevision(path) !== startRevision;
      runtime.buffers.set(path, savedDoc);
      if (!revisionAdvanced) {
        runtime.liveDocs.set(path, savedDoc);
      }
      runtime.clearExternalConflictBaseline(path);
      runtime.clearNewDocumentPath(path);
      runtime.pipeline.initPath(path, content);
      if (revisionAdvanced) {
        runtime.pipeline.bumpRevision(path);
      }
      runtime.commit(
        clearExternalDocumentConflict(
          runtime.setPathDirty(path, revisionAdvanced),
          path,
        ),
        !revisionAdvanced && runtime.getCurrentPath() === path ? { editorDoc: content } : undefined,
      );
      await refreshTree(path);
    } catch (error: unknown) {
      try {
        if (await fs.exists(path)) {
          const diskContent = await fs.readFile(path);
          runtime.setExternalConflictBaseline(path, createEditorDocumentText(diskContent));
          runtime.commit(setExternalDocumentConflict(runtime.getState(), {
            kind: "modified",
            path,
          }));
          return;
        }
      } catch (_recheckError: unknown) {
        // Preserve the deleted conflict below when the recheck cannot read a
        // usable replacement baseline.
      }
      console.error("[session] failed to restore deleted conflicted file:", path, error);
      runtime.commit(setExternalDocumentConflict(runtime.getState(), {
        kind: "deleted",
        path,
      }));
    }
  };

  const mergeExternalConflict = async (path: string): Promise<void> => {
    const conflict = runtime.getState().externalConflict;
    if (conflict?.path !== path) {
      return;
    }

    if (conflict.kind === "deleted") {
      await keepExternalConflict(path);
      return;
    }

    try {
      const diskDoc = runtime.externalConflictBaselines.get(path)
        ?? createEditorDocumentText(await fs.readFile(path));
      const baseDoc = runtime.buffers.get(path) ?? emptyEditorDocument;
      const localDoc = runtime.liveDocs.get(path) ?? baseDoc;
      const diskContent = editorDocumentToString(diskDoc);
      const merged = createExternalConflictMergeDocument({
        base: editorDocumentToString(baseDoc),
        disk: diskContent,
        local: editorDocumentToString(localDoc),
      });
      const mergedDoc = createEditorDocumentText(merged.content);
      const dirty = !mergedDoc.eq(diskDoc);

      runtime.buffers.set(path, diskDoc);
      runtime.liveDocs.set(path, mergedDoc);
      runtime.clearExternalConflictBaseline(path);
      runtime.clearNewDocumentPath(path);
      runtime.pipeline.initPath(path, diskContent);
      if (dirty) {
        runtime.pipeline.bumpRevision(path);
      }
      runtime.activeDocumentSignal.publish(path);
      runtime.commit(
        clearExternalDocumentConflict(
          runtime.setPathDirty(path, dirty),
          path,
        ),
        runtime.getCurrentPath() === path ? { editorDoc: merged.content } : undefined,
      );
    } catch (_error: unknown) {
      // If the disk side of the merge is gone, preserve the local doc as a deleted-file conflict.
      runtime.commit(setExternalDocumentConflict(runtime.getState(), {
        kind: "deleted",
        path,
      }));
    }
  };

  const cancelPendingOpenFile = () => runtime.cancelPendingOpenFile();

  const handleDocChange = (changes: readonly EditorDocumentChange[]) => {
    const currentPath = runtime.getCurrentPath();
    if (!currentPath) return;

    const previousDoc = documentTextForPath(currentPath, runtime.liveDocs, runtime.buffers);
    const doc = applyEditorDocumentChanges(previousDoc, changes);
    runtime.liveDocs.set(currentPath, doc);
    runtime.pipeline.bumpRevision(currentPath);
    runtime.activeDocumentSignal.publish(currentPath);

    const nextState = runtime.setPathDirty(
      currentPath,
      !doc.eq(runtime.buffers.get(currentPath) ?? emptyEditorDocument),
    );
    runtime.commit(nextState);
  };

  const handleDocumentSnapshot = (doc: string) => {
    const currentPath = runtime.getCurrentPath();
    if (!currentPath) return;

    const currentDoc = getCurrentDocText();
    const changes = createMinimalEditorDocumentChanges(currentDoc, doc);
    let dirty = runtime.isPathDirty(currentPath);
    if (changes.length > 0) {
      const previousDoc = documentTextForPath(currentPath, runtime.liveDocs, runtime.buffers);
      const nextDoc = applyEditorDocumentChanges(previousDoc, changes);
      runtime.liveDocs.set(currentPath, nextDoc);
      runtime.pipeline.bumpRevision(currentPath);
      runtime.activeDocumentSignal.publish(currentPath);
      dirty = !nextDoc.eq(runtime.buffers.get(currentPath) ?? emptyEditorDocument);
    }

    runtime.commit(
      runtime.setPathDirty(currentPath, dirty),
      { editorDoc: doc },
    );
  };

  const markCurrentDocumentDirty = () => {
    const currentPath = runtime.getCurrentPath();
    if (!currentPath || runtime.isPathDirty(currentPath)) {
      return;
    }

    runtime.activeDocumentSignal.publish(currentPath);
    runtime.commit(
      runtime.setPathDirty(currentPath, true),
    );
  };

  const handleProgrammaticDocChange = (path: string, doc: string) => {
    const currentDocument = runtime.getCurrentDocument();
    if (currentDocument?.path !== path) return;

    const nextDoc = createEditorDocumentText(doc);
    if (!runtime.isPathDirty(path)) {
      runtime.buffers.set(path, nextDoc);
    }
    runtime.liveDocs.set(path, nextDoc);
    runtime.commit(
      runtime.isPathDirty(path)
        ? runtime.getState()
        : runtime.setPathDirty(path, false),
      { editorDoc: doc },
    );
  };

  const openFile = async (path: string) => {
    const currentDocument = runtime.getCurrentDocument();
    if (currentDocument?.path === path) {
      addRecentFile(path);
      return;
    }

    const requestId = runtime.nextOpenFileRequest();
    const targetName = basename(path);
    const canLeave = await prepareCurrentDocumentForTransition("switch-file", {
      path,
      name: targetName,
    });
    if (!canLeave || !runtime.isLatestOpenFileRequest(requestId)) {
      return;
    }

    return withPerfOperation("open_file", async (operation) => {
      try {
        const existingDoc = runtime.liveDocs.get(path) ?? runtime.buffers.get(path);
        if (existingDoc) {
          const previousPath = runtime.getCurrentPath();
          if (
            previousPath &&
            previousPath !== path &&
            !runtime.isPathDirty(previousPath)
          ) {
            clearPathBuffers(previousPath);
          }
          const content = editorDocumentToString(existingDoc);
          runtime.commit(
            setCurrentSessionDocument(runtime.getState(), {
              path,
              name: targetName,
              dirty: runtime.isPathDirty(path),
            }),
            { editorDoc: content },
          );
          addRecentFile(path);
          return;
        }

        const content = await operation.measureAsync(
          "open_file.read",
          () => fs.readFile(path),
          { category: "open_file", detail: path },
        );

        if (!runtime.isLatestOpenFileRequest(requestId)) {
          return;
        }

        const previousPath = runtime.getCurrentPath();
        if (
          previousPath &&
          previousPath !== path &&
          !runtime.isPathDirty(previousPath)
        ) {
          clearPathBuffers(previousPath);
        }

        const documentText = createEditorDocumentText(content);
        runtime.buffers.set(path, documentText);
        runtime.liveDocs.set(path, documentText);
        runtime.pipeline.initPath(path, content);
        runtime.commit(
          setCurrentSessionDocument(runtime.getState(), {
            path,
            name: targetName,
            dirty: false,
          }),
          { editorDoc: content },
        );
        addRecentFile(path);
      } catch (error: unknown) {
        console.error("[session] failed to open file:", path, error);
        throw error;
      }
    }, path);
  };

  const openFileWithContent = async (name: string, content: string) => {
    const requestId = runtime.nextOpenFileRequest();
    const nextGeneratedPath = (basePath: string, suffix: number): string => {
      const directory = dirname(basePath);
      const fileName = basename(basePath);
      const dotIndex = fileName.lastIndexOf(".");
      const hasExtension = dotIndex > 0;
      const nextName = hasExtension
        ? `${fileName.slice(0, dotIndex)} (${suffix})${fileName.slice(dotIndex)}`
        : `${fileName} (${suffix})`;
      return directory ? `${directory}/${nextName}` : nextName;
    };

    const isPathAvailable = async (candidatePath: string): Promise<boolean> =>
      !runtime.hasPath(candidatePath) && !(await fs.exists(candidatePath));

    let path = name;
    let suffix = 1;
    while (!(await isPathAvailable(path))) {
      path = nextGeneratedPath(name, suffix++);
    }
    if (!runtime.isLatestOpenFileRequest(requestId)) return;

    const canLeave = await prepareCurrentDocumentForTransition("switch-file", {
      name: basename(path),
      path,
    });
    if (!canLeave || !runtime.isLatestOpenFileRequest(requestId)) return;

    const previousPath = runtime.getCurrentPath();
    if (
      previousPath &&
      previousPath !== path &&
      !runtime.isPathDirty(previousPath)
    ) {
      clearPathBuffers(previousPath);
    }

    runtime.buffers.set(path, emptyEditorDocument);
    runtime.liveDocs.set(path, createEditorDocumentText(content));
    runtime.pipeline.initPath(path, "");
    runtime.pipeline.bumpRevision(path);
    runtime.markNewDocumentPath(path);
    runtime.commit(
      setCurrentSessionDocument(runtime.getState(), {
        path,
        name: basename(path),
        dirty: true,
      }),
      { editorDoc: content },
    );
  };

  const restoreDocumentFromRecovery = async (
    path: string,
    content: string,
    options?: { baselineHash?: string },
  ) => {
    let restoredConflict: { kind: "deleted" | "modified"; path: string } | null = null;
    try {
      await openFile(path);
    } catch (_error: unknown) {
      // Recovery can restore content even when the original path no longer opens.
      await openFileWithContent(path, content);
      if (options?.baselineHash) {
        restoredConflict = { kind: "deleted", path };
      }
    }

    const recoveredDoc = createEditorDocumentText(content);
    runtime.liveDocs.set(path, recoveredDoc);
    runtime.pipeline.bumpRevision(path);
    runtime.activeDocumentSignal.publish(path);
    if (!restoredConflict && options?.baselineHash) {
      const currentBaselineHash = runtime.getPathBaselineHash(path);
      if (currentBaselineHash && currentBaselineHash !== options.baselineHash) {
        runtime.setExternalConflictBaseline(
          path,
          runtime.buffers.get(path) ?? emptyEditorDocument,
        );
        restoredConflict = { kind: "modified", path };
      }
    }

    const dirtyState = runtime.setPathDirty(path, true);
    runtime.commit(
      restoredConflict
        ? setExternalDocumentConflict(dirtyState, restoredConflict)
        : dirtyState,
      { editorDoc: content },
    );
  };

  const reloadFile = async (path: string) => {
    if (!runtime.hasPath(path)) return;

    try {
      const content = await fs.readFile(path);
      applyReloadedDocument(path, content);
    } catch (error: unknown) {
      console.error("[session] reload failed:", path, error);
      throw error;
    }
  };

  const syncExternalChange = async (path: string): Promise<ExternalDocumentSyncResult> => {
    const currentDocumentBeforeRead = runtime.getCurrentDocument();
    const affectsCurrentDocumentBeforeRead =
      currentDocumentBeforeRead !== null
      && pathAffectsDocument(path, currentDocumentBeforeRead.path);
    if (!runtime.hasPath(path) && !affectsCurrentDocumentBeforeRead) {
      return "ignore";
    }

    let content: string;
    try {
      content = await fs.readFile(path);
    } catch (_error: unknown) {
      // Watcher events may arrive after a file or ancestor has disappeared.
      const currentDocument = runtime.getCurrentDocument();
      if (!currentDocument || !pathAffectsDocument(path, currentDocument.path)) {
        return "ignore";
      }

      if (path !== currentDocument.path) {
        try {
          await fs.readFile(currentDocument.path);
          return "ignore";
        } catch (_currentPathError: unknown) {
          // The ancestor event affects the active document only when the
          // active path itself has disappeared or become unreadable.
        }
      }

      if (!runtime.isPathDirty(currentDocument.path)) {
        runtime.activeDocumentSignal.publish(currentDocument.path);
        runtime.commit(runtime.setPathDirty(currentDocument.path, true));
        return "ignore";
      }

      if (currentDocument.path === path) {
        runtime.commit(setExternalDocumentConflict(
          runtime.getState(),
          { kind: "deleted", path: currentDocument.path },
        ));
        return "notify";
      }
      return "ignore";
    }

    if (!runtime.hasPath(path)) {
      return "ignore";
    }

    if (runtime.pipeline.isSelfChange(path, content)) {
      return "self-change";
    }

    const currentDocument = runtime.getCurrentDocument();
    if (currentDocument?.path !== path) {
      return "ignore";
    }
    if (runtime.isPathDirty(currentDocument.path)) {
      runtime.setExternalConflictBaseline(path, createEditorDocumentText(content));
      runtime.commit(setExternalDocumentConflict(
        runtime.getState(),
        { kind: "modified", path },
      ));
      return "notify";
    }

    applyReloadedDocument(path, content);
    return "reloaded";
  };

  const createFile = async (path: string) => {
    try {
      await measureAsync("create_file.write", () => fs.createFile(path, ""), {
        category: "create_file",
        detail: path,
      });
      await refreshTree(path);
      await openFile(path);
    } catch (error: unknown) {
      console.error("[session] create file failed:", error);
    }
  };

  const createDirectory = async (path: string) => {
    try {
      await measureAsync("create_directory.write", () => fs.createDirectory(path), {
        category: "create_directory",
        detail: path,
      });
      await refreshTree(path);
    } catch (error: unknown) {
      console.error("[session] create directory failed:", error);
    }
  };

  const closeCurrentFile = async (
    options?: { discard?: boolean },
  ): Promise<boolean> => {
    const currentDocument = runtime.getCurrentDocument();
    if (!currentDocument) return true;

    if (!options?.discard) {
      const canClose = await prepareCurrentDocumentForTransition("close-file");
      if (!canClose) return false;
    } else if (runtime.isPathDirty(currentDocument.path)) {
      notifyAfterDiscard(currentDocument.path);
    }

    clearPathBuffers(currentDocument.path);
    runtime.commit(
      clearSessionDocument(runtime.getState(), currentDocument.path),
      { editorDoc: "" },
    );
    return true;
  };

  const handleWindowCloseRequest = async (): Promise<boolean> =>
    prepareCurrentDocumentForTransition("close-window");

  return {
    getCurrentDocText,
    isPathOpen,
    isPathDirty,
    cancelPendingOpenFile,
    handleDocChange,
    handleDocumentSnapshot,
    markCurrentDocumentDirty,
    handleProgrammaticDocChange,
    prepareCurrentDocumentForTransition,
    openFile,
    openFileWithContent,
    restoreDocumentFromRecovery,
    reloadFile,
    syncExternalChange,
    keepExternalConflict,
    mergeExternalConflict,
    createFile,
    createDirectory,
    closeCurrentFile,
    handleWindowCloseRequest,
  };
}
