import type { RefObject } from "react";
import { basename } from "./lib/utils";
import {
  clearSessionDocument,
  markSessionDocumentDirty,
  setCurrentSessionDocument,
} from "./editor-session-actions";
import {
  getCurrentSessionDocument,
  hasSessionPath,
  type EditorSessionState,
  type SessionDocument,
} from "./editor-session-model";
import type { FileSystem } from "./file-manager";
import { measureAsync, withPerfOperation } from "./perf";
import type { SavePipeline } from "./save-pipeline";
import type { SourceMap } from "./source-map";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "./unsaved-changes";
import {
  applyEditorDocumentChanges,
  createEditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
  type EditorDocumentChange,
  type EditorDocumentText,
} from "./editor-doc-change";
import type { ActiveDocumentSignal } from "./active-document-signal";

export interface CommitSessionStateOptions {
  editorDoc?: string;
  syncEditorDoc?: boolean;
}

export type CommitSessionState = (
  nextState: EditorSessionState,
  options?: CommitSessionStateOptions,
) => void;

export type ExternalDocumentSyncResult = "ignore" | "notify" | "reloaded";

export interface EditorSessionService {
  getCurrentDocText: () => string;
  isPathOpen: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
  cancelPendingOpenFile: () => void;
  handleDocChange: (changes: readonly EditorDocumentChange[]) => void;
  handleProgrammaticDocChange: (path: string, doc: string) => void;
  setDocumentSourceMap: (path: string, sourceMap: SourceMap | null) => void;
  openFile: (path: string) => Promise<void>;
  openFileWithContent: (name: string, content: string) => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  syncExternalChange: (path: string) => Promise<ExternalDocumentSyncResult>;
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
  stateRef: RefObject<EditorSessionState>;
  buffers: RefObject<Map<string, EditorDocumentText>>;
  liveDocs: RefObject<Map<string, EditorDocumentText>>;
  sourceMaps: RefObject<Map<string, SourceMap>>;
  pipeline: SavePipeline;
  activeDocumentSignal: ActiveDocumentSignal;
  openFileRequestRef: RefObject<number>;
  commitSessionState: CommitSessionState;
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

export function documentForPath(
  path: string | null,
  liveDocs: RefObject<Map<string, EditorDocumentText>>,
  buffers: RefObject<Map<string, EditorDocumentText>>,
): string {
  if (!path) return "";
  return editorDocumentToString(
    liveDocs.current.get(path)
    ?? buffers.current.get(path)
    ?? emptyEditorDocument,
  );
}

export function documentTextForPath(
  path: string | null,
  liveDocs: RefObject<Map<string, EditorDocumentText>>,
  buffers: RefObject<Map<string, EditorDocumentText>>,
): EditorDocumentText {
  if (!path) return emptyEditorDocument;
  return liveDocs.current.get(path) ?? buffers.current.get(path) ?? emptyEditorDocument;
}

export function createEditorSessionService({
  fs,
  refreshTree,
  addRecentFile,
  requestUnsavedChangesDecision,
  stateRef,
  buffers,
  liveDocs,
  sourceMaps,
  pipeline,
  activeDocumentSignal,
  openFileRequestRef,
  commitSessionState,
  saveCurrentDocument,
}: EditorSessionServiceOptions): EditorSessionService {
  const clearPathBuffers = (path: string) => {
    pipeline.clear(path);
    buffers.current.delete(path);
    liveDocs.current.delete(path);
    sourceMaps.current.delete(path);
  };

  const applyReloadedDocument = (path: string, content: string) => {
    if (!hasSessionPath(stateRef.current, path)) {
      return false;
    }

    const documentText = createEditorDocumentText(content);
    clearPathBuffers(path);
    buffers.current.set(path, documentText);
    liveDocs.current.set(path, documentText);
    pipeline.initPath(path, content);
    commitSessionState(
      markSessionDocumentDirty(stateRef.current, path, false),
      stateRef.current.currentDocument?.path === path
        ? { editorDoc: content }
        : undefined,
    );
    return true;
  };

  const discardDocumentChanges = (path: string) => {
    const savedDoc = buffers.current.get(path) ?? emptyEditorDocument;
    liveDocs.current.set(path, savedDoc);
    commitSessionState(
      markSessionDocumentDirty(stateRef.current, path, false),
      stateRef.current.currentDocument?.path === path
        ? { editorDoc: editorDocumentToString(savedDoc) }
        : undefined,
    );
  };

  const prepareCurrentDocumentForTransition = async (
    reason: UnsavedChangesRequest["reason"],
    target?: { path?: string; name: string },
  ): Promise<boolean> => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
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
    documentForPath(stateRef.current.currentDocument?.path ?? null, liveDocs, buffers);

  const isPathOpen = (path: string): boolean => hasSessionPath(stateRef.current, path);

  const isPathDirty = (path: string): boolean => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    return currentDocument?.path === path && currentDocument.dirty;
  };

  const cancelPendingOpenFile = () => {
    openFileRequestRef.current += 1;
  };

  const handleDocChange = (changes: readonly EditorDocumentChange[]) => {
    const currentPath = stateRef.current.currentDocument?.path;
    if (!currentPath) return;

    const previousDoc = documentTextForPath(currentPath, liveDocs, buffers);
    const doc = applyEditorDocumentChanges(previousDoc, changes);
    liveDocs.current.set(currentPath, doc);
    pipeline.bumpRevision(currentPath);
    activeDocumentSignal.publish(currentPath);

    const isDirty = !doc.eq(buffers.current.get(currentPath) ?? emptyEditorDocument);
    const nextState = markSessionDocumentDirty(stateRef.current, currentPath, isDirty);
    if (nextState !== stateRef.current) {
      commitSessionState(nextState);
    }
  };

  const handleProgrammaticDocChange = (path: string, doc: string) => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (currentDocument?.path !== path) return;

    const nextDoc = createEditorDocumentText(doc);
    if (!currentDocument.dirty) {
      buffers.current.set(path, nextDoc);
    }
    liveDocs.current.set(path, nextDoc);
    commitSessionState(
      currentDocument.dirty
        ? stateRef.current
        : markSessionDocumentDirty(stateRef.current, path, false),
      { editorDoc: doc },
    );
  };

  const setDocumentSourceMap = (path: string, sourceMap: SourceMap | null) => {
    if (sourceMap) {
      sourceMaps.current.set(path, sourceMap);
      return;
    }
    sourceMaps.current.delete(path);
  };

  const openFile = async (path: string) => {
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (currentDocument?.path === path) {
      addRecentFile(path);
      return;
    }

    const requestId = ++openFileRequestRef.current;
    const targetName = basename(path);
    const canLeave = await prepareCurrentDocumentForTransition("switch-file", {
      path,
      name: targetName,
    });
    if (!canLeave || requestId !== openFileRequestRef.current) {
      return;
    }

    return withPerfOperation("open_file", async (operation) => {
      try {
        const content = await operation.measureAsync(
          "open_file.read",
          () => fs.readFile(path),
          { category: "open_file", detail: path },
        );

        if (requestId !== openFileRequestRef.current) {
          return;
        }

        const previousPath = stateRef.current.currentDocument?.path ?? null;
        if (previousPath && previousPath !== path) {
          clearPathBuffers(previousPath);
        }

        const documentText = createEditorDocumentText(content);
        sourceMaps.current.delete(path);
        buffers.current.set(path, documentText);
        liveDocs.current.set(path, documentText);
        pipeline.initPath(path, content);
        commitSessionState(
          setCurrentSessionDocument(stateRef.current, {
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
    const requestId = ++openFileRequestRef.current;
    let path = name;
    let suffix = 1;
    while (hasSessionPath(stateRef.current, path)) {
      path = `${name} (${suffix++})`;
    }

    const canLeave = await prepareCurrentDocumentForTransition("switch-file", {
      name: basename(path),
      path,
    });
    if (!canLeave || requestId !== openFileRequestRef.current) return;

    const previousPath = stateRef.current.currentDocument?.path ?? null;
    if (previousPath && previousPath !== path) {
      clearPathBuffers(previousPath);
    }

    sourceMaps.current.delete(path);
    buffers.current.set(path, emptyEditorDocument);
    liveDocs.current.set(path, createEditorDocumentText(content));
    commitSessionState(
      setCurrentSessionDocument(stateRef.current, {
        path,
        name: basename(path),
        dirty: true,
      }),
      { editorDoc: content },
    );
  };

  const reloadFile = async (path: string) => {
    if (!hasSessionPath(stateRef.current, path)) return;

    try {
      const content = await fs.readFile(path);
      applyReloadedDocument(path, content);
    } catch (error: unknown) {
      console.error("[session] reload failed:", path, error);
      throw error;
    }
  };

  const syncExternalChange = async (path: string): Promise<ExternalDocumentSyncResult> => {
    if (!hasSessionPath(stateRef.current, path)) {
      return "ignore";
    }

    let content: string;
    try {
      content = await fs.readFile(path);
    } catch {
      const currentDocument = getCurrentSessionDocument(stateRef.current);
      return currentDocument?.path === path && currentDocument.dirty
        ? "notify"
        : "ignore";
    }

    if (!hasSessionPath(stateRef.current, path)) {
      return "ignore";
    }

    if (pipeline.isSelfChange(path, content)) {
      return "ignore";
    }

    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (currentDocument?.path !== path) {
      return "ignore";
    }
    if (currentDocument.dirty) {
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
    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (!currentDocument) return true;

    if (!options?.discard) {
      const canClose = await prepareCurrentDocumentForTransition("close-file");
      if (!canClose) return false;
    }

    clearPathBuffers(currentDocument.path);
    commitSessionState(
      clearSessionDocument(stateRef.current, currentDocument.path),
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
    handleProgrammaticDocChange,
    setDocumentSourceMap,
    openFile,
    openFileWithContent,
    reloadFile,
    syncExternalChange,
    createFile,
    createDirectory,
    closeCurrentFile,
    handleWindowCloseRequest,
  };
}
