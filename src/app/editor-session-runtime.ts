import {
  editorDocumentToString,
  emptyEditorDocument,
  type EditorDocumentText,
} from "./editor-doc-change";
import {
  createEditorSessionState,
  type EditorSessionState,
  type ExternalDocumentConflict,
  type SessionDocument,
  hasSessionPath,
  getCurrentSessionDocument,
} from "./editor-session-model";
import { createActiveDocumentSignal, type ActiveDocumentSignal } from "./active-document-signal";
import { SavePipeline, type SaveSnapshot } from "./save-pipeline";

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
  hasPath: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
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
    hasPath: (path) => hasSessionPath(state, path),
    isPathDirty: (path) => getCurrentSessionDocument(state)?.path === path
      && getCurrentSessionDocument(state)?.dirty === true,
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
