import { basename } from "./lib/utils";
import {
  clearExternalDocumentConflict,
  clearSessionDocument,
  markSessionDocumentDirty,
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
  openFile: (path: string) => Promise<void>;
  openFileWithContent: (name: string, content: string) => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  syncExternalChange: (path: string) => Promise<ExternalDocumentSyncResult>;
  keepExternalConflict: (path: string) => Promise<void>;
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
  saveCurrentDocument,
}: EditorSessionServiceOptions): EditorSessionService {
  const clearPathBuffers = (path: string) => {
    runtime.pipeline.clear(path);
    runtime.buffers.delete(path);
    runtime.liveDocs.delete(path);
    runtime.externalConflictBaselines.delete(path);
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
        markSessionDocumentDirty(runtime.getState(), path, false),
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
      markSessionDocumentDirty(runtime.getState(), path, false),
      runtime.getCurrentPath() === path
        ? { editorDoc: editorDocumentToString(savedDoc) }
        : undefined,
    );
  };

  const prepareCurrentDocumentForTransition = async (
    reason: UnsavedChangesRequest["reason"],
    target?: { path?: string; name: string },
  ): Promise<boolean> => {
    const currentDocument = runtime.getCurrentDocument();
    if (!currentDocument || !currentDocument.dirty) {
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
        runtime.externalConflictBaselines.delete(path);
        runtime.pipeline.initPath(path, diskContent);
        runtime.commit(
          clearExternalDocumentConflict(
            markSessionDocumentDirty(runtime.getState(), path, !liveDoc.eq(diskDoc)),
            path,
          ),
        );
        return;
      } catch (_error: unknown) {
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
        runtime.externalConflictBaselines.set(path, createEditorDocumentText(diskContent));
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
      runtime.externalConflictBaselines.delete(path);
      runtime.pipeline.initPath(path, content);
      if (revisionAdvanced) {
        runtime.pipeline.bumpRevision(path);
      }
      runtime.commit(
        clearExternalDocumentConflict(
          markSessionDocumentDirty(runtime.getState(), path, revisionAdvanced),
          path,
        ),
        !revisionAdvanced && runtime.getCurrentPath() === path ? { editorDoc: content } : undefined,
      );
      await refreshTree(path);
    } catch (error: unknown) {
      console.error("[session] failed to restore deleted conflicted file:", path, error);
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

    const nextState = markSessionDocumentDirty(
      runtime.getState(),
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
    let dirty = runtime.getCurrentDocument()?.dirty ?? false;
    if (changes.length > 0) {
      const previousDoc = documentTextForPath(currentPath, runtime.liveDocs, runtime.buffers);
      const nextDoc = applyEditorDocumentChanges(previousDoc, changes);
      runtime.liveDocs.set(currentPath, nextDoc);
      runtime.pipeline.bumpRevision(currentPath);
      runtime.activeDocumentSignal.publish(currentPath);
      dirty = !nextDoc.eq(runtime.buffers.get(currentPath) ?? emptyEditorDocument);
    }

    runtime.commit(
      markSessionDocumentDirty(runtime.getState(), currentPath, dirty),
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
      markSessionDocumentDirty(runtime.getState(), currentPath, true),
    );
  };

  const handleProgrammaticDocChange = (path: string, doc: string) => {
    const currentDocument = runtime.getCurrentDocument();
    if (currentDocument?.path !== path) return;

    const nextDoc = createEditorDocumentText(doc);
    if (!currentDocument.dirty) {
      runtime.buffers.set(path, nextDoc);
    }
    runtime.liveDocs.set(path, nextDoc);
    runtime.commit(
      currentDocument.dirty
        ? runtime.getState()
        : markSessionDocumentDirty(runtime.getState(), path, false),
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
        const content = await operation.measureAsync(
          "open_file.read",
          () => fs.readFile(path),
          { category: "open_file", detail: path },
        );

        if (!runtime.isLatestOpenFileRequest(requestId)) {
          return;
        }

        const previousPath = runtime.getCurrentPath();
        if (previousPath && previousPath !== path) {
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
    let path = name;
    let suffix = 1;
    while (runtime.hasPath(path)) {
      path = `${name} (${suffix++})`;
    }

    const canLeave = await prepareCurrentDocumentForTransition("switch-file", {
      name: basename(path),
      path,
    });
    if (!canLeave || !runtime.isLatestOpenFileRequest(requestId)) return;

    const previousPath = runtime.getCurrentPath();
    if (previousPath && previousPath !== path) {
      clearPathBuffers(previousPath);
    }

    runtime.buffers.set(path, emptyEditorDocument);
    runtime.liveDocs.set(path, createEditorDocumentText(content));
    runtime.commit(
      setCurrentSessionDocument(runtime.getState(), {
        path,
        name: basename(path),
        dirty: true,
      }),
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

      if (!currentDocument.dirty) {
        runtime.activeDocumentSignal.publish(currentDocument.path);
        runtime.commit(markSessionDocumentDirty(runtime.getState(), currentDocument.path, true));
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
    if (currentDocument.dirty) {
      runtime.externalConflictBaselines.set(path, createEditorDocumentText(content));
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
    openFile,
    openFileWithContent,
    reloadFile,
    syncExternalChange,
    keepExternalConflict,
    createFile,
    createDirectory,
    closeCurrentFile,
    handleWindowCloseRequest,
  };
}
