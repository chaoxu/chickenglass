import { basename } from "./lib/utils";
import {
  clearSessionDocument,
  markSessionDocumentDirty,
  setCurrentSessionDocument,
} from "./editor-session-actions";
import {
  type SessionDocument,
} from "./editor-session-model";
import type { FileSystem } from "./file-manager";
import { measureAsync, withPerfOperation } from "./perf";
import {
  createEditorDocumentChangePositionMapping,
  type SourceMap,
} from "./source-map";
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
} from "../lib/editor-doc-change";
import {
  documentForPath,
  documentTextForPath,
  type EditorSessionRuntime,
} from "./editor-session-runtime";
import {
  clearPathBuffers,
  installPathDocument,
  resetLiveDocToBuffer,
} from "./editor-session-buffers";
import { expandDocumentIncludes } from "./include-resolver";

export type ExternalDocumentSyncResult = "ignore" | "notify" | "reloaded";

export interface EditorSessionService {
  getCurrentDocText: () => string;
  getCurrentSourceMap: () => SourceMap | null;
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

export function createEditorSessionService({
  fs,
  refreshTree,
  addRecentFile,
  requestUnsavedChangesDecision,
  runtime,
  saveCurrentDocument,
}: EditorSessionServiceOptions): EditorSessionService {
  const applyReloadedDocument = (
    path: string,
    content: string,
    sourceMap: SourceMap | null,
    rawContent: string,
  ) => {
    if (!runtime.hasPath(path)) {
      return false;
    }

    const documentText = createEditorDocumentText(content);
    clearPathBuffers(runtime, path);
    installPathDocument(runtime, path, documentText, rawContent, sourceMap);
    runtime.commit(
      markSessionDocumentDirty(runtime.getState(), path, false),
      runtime.getCurrentPath() === path
        ? { editorDoc: content }
        : undefined,
    );
    return true;
  };

  const discardDocumentChanges = (path: string) => {
    const savedDoc = resetLiveDocToBuffer(runtime, path);
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

  const getCurrentSourceMap = (): SourceMap | null => {
    const currentPath = runtime.getCurrentPath();
    return currentPath ? runtime.sourceMaps.get(currentPath) ?? null : null;
  };

  const isPathOpen = (path: string): boolean => runtime.hasPath(path);

  const isPathDirty = (path: string): boolean => runtime.isPathDirty(path);

  const cancelPendingOpenFile = () => runtime.cancelPendingOpenFile();

  const handleDocChange = (changes: readonly EditorDocumentChange[]) => {
    const currentPath = runtime.getCurrentPath();
    if (!currentPath) return;

    const previousDoc = documentTextForPath(currentPath, runtime.liveDocs, runtime.buffers);
    const doc = applyEditorDocumentChanges(previousDoc, changes);
    const sourceMap = runtime.sourceMaps.get(currentPath);
    if (sourceMap && changes.length > 0) {
      if (sourceMap.canMapDocumentChanges(changes)) {
        sourceMap.mapThrough(createEditorDocumentChangePositionMapping(changes));
      } else {
        runtime.sourceMaps.delete(currentPath);
      }
    }
    runtime.liveDocs.set(currentPath, doc);
    runtime.pipeline.bumpRevision(currentPath);
    runtime.activeDocumentSignal.publish(currentPath);

    const nextState = markSessionDocumentDirty(
      runtime.getState(),
      currentPath,
      doc !== (runtime.buffers.get(currentPath) ?? emptyEditorDocument),
    );
    runtime.commit(nextState);
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

  const setDocumentSourceMap = (path: string, sourceMap: SourceMap | null) => {
    if (sourceMap) {
      runtime.sourceMaps.set(path, sourceMap);
      return;
    }
    runtime.sourceMaps.delete(path);
  };

  const reportIncludeExpansionFailure = (
    path: string,
    expanded: {
      readonly failure?: { readonly message: string } | null;
      readonly sourceMap: SourceMap | null;
      readonly text: string;
    },
  ) => {
    if (expanded.failure) {
      console.warn("[includes] expansion failed:", path, expanded.failure.message);
    }
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
        const rawContent = await operation.measureAsync(
          "open_file.read",
          () => fs.readFile(path),
          { category: "open_file", detail: path },
        );
        const expanded = path.endsWith(".md")
          ? await operation.measureAsync(
            "open_file.expand_includes",
            () => expandDocumentIncludes(path, rawContent, fs),
            { category: "open_file", detail: path },
          )
          : { sourceMap: null, text: rawContent };

        if (!runtime.isLatestOpenFileRequest(requestId)) {
          return;
        }

        const previousPath = runtime.getCurrentPath();
        if (previousPath && previousPath !== path) {
          clearPathBuffers(runtime, previousPath);
        }

        const documentText = createEditorDocumentText(expanded.text);
        runtime.sourceMaps.delete(path);
        reportIncludeExpansionFailure(path, expanded);
        installPathDocument(runtime, path, documentText, rawContent, expanded.sourceMap ?? null);
        runtime.commit(
          setCurrentSessionDocument(runtime.getState(), {
            path,
            name: targetName,
            dirty: false,
          }),
          { editorDoc: expanded.text },
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

    const existingContent = await fs.exists(path) ? await fs.readFile(path) : null;
    if (!runtime.isLatestOpenFileRequest(requestId)) {
      return;
    }
    if (existingContent === null) {
      await fs.createFile(path, content);
    }
    if (!runtime.isLatestOpenFileRequest(requestId)) {
      return;
    }

    const previousPath = runtime.getCurrentPath();
    if (previousPath && previousPath !== path) {
      clearPathBuffers(runtime, previousPath);
    }

    const documentText = createEditorDocumentText(content);
    const bufferText = createEditorDocumentText(existingContent ?? content);
    runtime.sourceMaps.delete(path);
    runtime.pipeline.initPath(path, existingContent ?? content);
    runtime.buffers.set(path, bufferText);
    runtime.liveDocs.set(path, documentText);
    runtime.commit(
      setCurrentSessionDocument(runtime.getState(), {
        path,
        name: basename(path),
        dirty: documentText !== bufferText,
      }),
      { editorDoc: content },
    );
  };

  const reloadFile = async (path: string) => {
    if (!runtime.hasPath(path)) return;

    try {
      const rawContent = await fs.readFile(path);
      const expanded = path.endsWith(".md")
        ? await expandDocumentIncludes(path, rawContent, fs)
        : { sourceMap: null, text: rawContent };
      reportIncludeExpansionFailure(path, expanded);
      applyReloadedDocument(path, expanded.text, expanded.sourceMap, rawContent);
    } catch (error: unknown) {
      console.error("[session] reload failed:", path, error);
      throw error;
    }
  };

  const syncExternalChange = async (path: string): Promise<ExternalDocumentSyncResult> => {
    if (!runtime.hasPath(path)) {
      return "ignore";
    }

    let rawContent: string;
    try {
      rawContent = await fs.readFile(path);
    } catch {
      const currentDocument = runtime.getCurrentDocument();
      return currentDocument?.path === path && currentDocument.dirty
        ? "notify"
        : "ignore";
    }

    if (!runtime.hasPath(path)) {
      return "ignore";
    }

    if (runtime.pipeline.isSelfChange(path, rawContent)) {
      return "ignore";
    }

    const currentDocument = runtime.getCurrentDocument();
    if (currentDocument?.path !== path) {
      return "ignore";
    }
    if (currentDocument.dirty) {
      return "notify";
    }

    const expanded = path.endsWith(".md")
      ? await expandDocumentIncludes(path, rawContent, fs)
      : { sourceMap: null, text: rawContent };
    reportIncludeExpansionFailure(path, expanded);
    applyReloadedDocument(path, expanded.text, expanded.sourceMap, rawContent);
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

    clearPathBuffers(runtime, currentDocument.path);
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
    getCurrentSourceMap,
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
