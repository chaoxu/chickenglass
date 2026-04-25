import {
  editorDocumentToString,
  emptyEditorDocument,
  type EditorDocumentText,
} from "./editor-doc-change";
import { basename } from "./lib/utils";
import {
  createEditorSessionState,
  type EditorSessionState,
  type ExternalDocumentConflict,
  type SessionDocument,
  hasSessionPath,
  isSessionPathDirty,
  getCurrentSessionDocument,
} from "./editor-session-model";
import { createActiveDocumentSignal, type ActiveDocumentSignal } from "./active-document-signal";
import { fnv1aHash, SavePipeline, type SaveSnapshot } from "./save-pipeline";

export interface EditorSessionSnapshot {
  currentDocument: SessionDocument | null;
  currentPath: string | null;
  editorDoc: string;
  externalConflict: ExternalDocumentConflict | null;
}

export interface CommitSessionStateOptions {
  editorDoc?: string;
  syncEditorDoc?: boolean;
}

type SessionListener = () => void;
type WriteDocumentSnapshot = (
  path: string,
  snapshot: SaveSnapshot,
) => Promise<string>;

export interface EditorSessionRuntime {
  readonly buffers: Map<string, EditorDocumentText>;
  readonly liveDocs: Map<string, EditorDocumentText>;
  readonly externalConflictBaselines: Map<string, EditorDocumentText>;
  readonly newDocumentPaths: Set<string>;
  readonly pipeline: SavePipeline;
  readonly activeDocumentSignal: ActiveDocumentSignal;
  subscribe: (listener: SessionListener) => () => void;
  getSnapshot: () => EditorSessionSnapshot;
  getState: () => EditorSessionState;
  getCurrentDocument: () => SessionDocument | null;
  getCurrentPath: () => string | null;
  getEditorDoc: () => string;
  getCurrentDocText: () => string;
  getPathBaselineHash: (path: string) => string | null;
  hasPath: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
  setExternalConflictBaseline: (path: string, doc: EditorDocumentText) => void;
  clearExternalConflictBaseline: (path: string) => void;
  markNewDocumentPath: (path: string) => void;
  clearNewDocumentPath: (path: string) => void;
  remapPathMetadata: (oldPath: string, newPath: string) => Set<string>;
  commit: (nextState: EditorSessionState, options?: CommitSessionStateOptions) => void;
  cancelPendingOpenFile: () => void;
  nextOpenFileRequest: () => number;
  isLatestOpenFileRequest: (requestId: number) => boolean;
  setWriteDocumentSnapshot: (writeDocumentSnapshot: WriteDocumentSnapshot) => void;
}

export function documentForPath(
  path: string | null,
  liveDocs: ReadonlyMap<string, EditorDocumentText>,
  buffers: ReadonlyMap<string, EditorDocumentText>,
): string {
  if (!path) return "";
  return editorDocumentToString(
    liveDocs.get(path)
    ?? buffers.get(path)
    ?? emptyEditorDocument,
  );
}

export function documentTextForPath(
  path: string | null,
  liveDocs: ReadonlyMap<string, EditorDocumentText>,
  buffers: ReadonlyMap<string, EditorDocumentText>,
): EditorDocumentText {
  if (!path) return emptyEditorDocument;
  return liveDocs.get(path) ?? buffers.get(path) ?? emptyEditorDocument;
}

export function remapSessionPath(
  path: string,
  oldPath: string,
  newPath: string,
): string | null {
  if (path === oldPath) return newPath;
  if (oldPath !== "" && path.startsWith(`${oldPath}/`)) {
    return `${newPath}/${path.slice(oldPath.length + 1)}`;
  }
  return null;
}

export function remapEditorSessionStatePaths(
  state: EditorSessionState,
  oldPath: string,
  newPath: string,
): EditorSessionState {
  const currentDocument = state.currentDocument;
  const remappedCurrentPath = currentDocument
    ? remapSessionPath(currentDocument.path, oldPath, newPath)
    : null;
  const externalConflict = state.externalConflict;
  const remappedConflictPath = externalConflict
    ? remapSessionPath(externalConflict.path, oldPath, newPath)
    : null;

  if (!remappedCurrentPath && !remappedConflictPath) {
    return state;
  }

  return {
    currentDocument: currentDocument && remappedCurrentPath
      ? {
        ...currentDocument,
        path: remappedCurrentPath,
        name: basename(remappedCurrentPath),
      }
      : currentDocument,
    externalConflict: externalConflict && remappedConflictPath
      ? {
        ...externalConflict,
        path: remappedConflictPath,
      }
      : externalConflict,
  };
}

export function createEditorSessionRuntime(): EditorSessionRuntime {
  let state = createEditorSessionState();
  let editorDoc = "";
  let openFileRequest = 0;
  let writeDocumentSnapshot: WriteDocumentSnapshot = async () => "";
  let snapshot: EditorSessionSnapshot = {
    currentDocument: null,
    currentPath: null,
    editorDoc: "",
    externalConflict: null,
  };

  const buffers = new Map<string, EditorDocumentText>();
  const liveDocs = new Map<string, EditorDocumentText>();
  const externalConflictBaselines = new Map<string, EditorDocumentText>();
  const newDocumentPaths = new Set<string>();
  const listeners = new Set<SessionListener>();
  const activeDocumentSignal = createActiveDocumentSignal();
  const pipeline = new SavePipeline((path, snapshot) =>
    writeDocumentSnapshot(path, snapshot),
  );

  const refreshSnapshot = () => {
    snapshot = {
      currentDocument: state.currentDocument,
      currentPath: state.currentDocument?.path ?? null,
      editorDoc,
      externalConflict: state.externalConflict,
    };
  };

  const emitIfChanged = (
    previousState: EditorSessionState,
    previousEditorDoc: string,
  ) => {
    if (previousState === state && previousEditorDoc === editorDoc) {
      return;
    }
    refreshSnapshot();
    for (const listener of listeners) {
      listener();
    }
  };

  refreshSnapshot();

  return {
    buffers,
    liveDocs,
    externalConflictBaselines,
    newDocumentPaths,
    pipeline,
    activeDocumentSignal,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getState: () => state,
    getCurrentDocument: () => getCurrentSessionDocument(state),
    getCurrentPath: () => state.currentDocument?.path ?? null,
    getEditorDoc: () => editorDoc,
    getCurrentDocText: () => documentForPath(state.currentDocument?.path ?? null, liveDocs, buffers),
    getPathBaselineHash: (path) => {
      if (newDocumentPaths.has(path)) {
        return null;
      }
      const pipelineHash = pipeline.getLastSavedHash(path);
      if (pipelineHash !== undefined) {
        return pipelineHash;
      }
      const bufferedDoc = buffers.get(path);
      return bufferedDoc ? fnv1aHash(editorDocumentToString(bufferedDoc)) : null;
    },
    hasPath: (path) => hasSessionPath(state, path),
    isPathDirty: (path) => isSessionPathDirty(state, path),
    setExternalConflictBaseline: (path, doc) => {
      externalConflictBaselines.set(path, doc);
      newDocumentPaths.delete(path);
    },
    clearExternalConflictBaseline: (path) => {
      externalConflictBaselines.delete(path);
    },
    markNewDocumentPath: (path) => {
      newDocumentPaths.add(path);
      externalConflictBaselines.delete(path);
    },
    clearNewDocumentPath: (path) => {
      newDocumentPaths.delete(path);
    },
    remapPathMetadata: (oldPath, newPath) => {
      const pathsToRename = new Map<string, string>();
      const addRemappedPath = (path: string) => {
        const remapped = remapSessionPath(path, oldPath, newPath);
        if (remapped) {
          pathsToRename.set(path, remapped);
        }
      };

      for (const path of buffers.keys()) {
        addRemappedPath(path);
      }
      for (const path of liveDocs.keys()) {
        addRemappedPath(path);
      }
      for (const path of externalConflictBaselines.keys()) {
        addRemappedPath(path);
      }
      for (const path of newDocumentPaths) {
        addRemappedPath(path);
      }
      const currentDocument = getCurrentSessionDocument(state);
      if (currentDocument) {
        addRemappedPath(currentDocument.path);
      }

      const remappedPaths = new Set<string>();
      for (const [oldDocumentPath, newDocumentPath] of pathsToRename) {
        const buffered = buffers.get(oldDocumentPath);
        const liveDoc = liveDocs.get(oldDocumentPath);
        const conflictBaseline = externalConflictBaselines.get(oldDocumentPath);
        const wasNewDocument = newDocumentPaths.has(oldDocumentPath);

        buffers.delete(oldDocumentPath);
        liveDocs.delete(oldDocumentPath);
        externalConflictBaselines.delete(oldDocumentPath);
        newDocumentPaths.delete(oldDocumentPath);

        if (buffered !== undefined) {
          buffers.set(newDocumentPath, buffered);
        }
        if (liveDoc !== undefined) {
          liveDocs.set(newDocumentPath, liveDoc);
        }
        if (conflictBaseline !== undefined) {
          externalConflictBaselines.set(newDocumentPath, conflictBaseline);
        }
        if (wasNewDocument) {
          newDocumentPaths.add(newDocumentPath);
        }

        pipeline.clear(oldDocumentPath);
        pipeline.initPath(
          newDocumentPath,
          editorDocumentToString(buffered ?? liveDoc ?? conflictBaseline ?? emptyEditorDocument),
        );
        remappedPaths.add(newDocumentPath);
      }
      return remappedPaths;
    },
    commit: (nextState, options) => {
      const previousState = state;
      const previousEditorDoc = editorDoc;
      state = nextState;

      if (options !== undefined && "editorDoc" in options) {
        editorDoc = options.editorDoc ?? "";
        activeDocumentSignal.publish(nextState.currentDocument?.path ?? null);
        emitIfChanged(previousState, previousEditorDoc);
        return;
      }

      if (options?.syncEditorDoc) {
        editorDoc = documentForPath(nextState.currentDocument?.path ?? null, liveDocs, buffers);
        activeDocumentSignal.publish(nextState.currentDocument?.path ?? null);
      }

      emitIfChanged(previousState, previousEditorDoc);
    },
    cancelPendingOpenFile: () => {
      openFileRequest += 1;
    },
    nextOpenFileRequest: () => {
      openFileRequest += 1;
      return openFileRequest;
    },
    isLatestOpenFileRequest: (requestId) => requestId === openFileRequest,
    setWriteDocumentSnapshot: (nextWriteDocumentSnapshot) => {
      writeDocumentSnapshot = nextWriteDocumentSnapshot;
    },
  };
}
