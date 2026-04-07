import { useCallback, useMemo, useRef, useState } from "react";
import type { FileSystem } from "../file-manager";
import {
  createEditorSessionState,
  type EditorSessionState,
  type SessionDocument,
} from "../editor-session-model";
import { SavePipeline } from "../save-pipeline";
import type { SourceMap } from "../source-map";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "../unsaved-changes";
import {
  type EditorDocumentChange,
  type EditorDocumentText,
} from "../editor-doc-change";
import {
  createActiveDocumentSignal,
  type ActiveDocumentSignal,
} from "../active-document-signal";
import {
  createEditorSessionService,
  documentForPath,
  type ExternalDocumentSyncResult,
} from "../editor-session-service";
import { useEditorSessionPersistence } from "./use-editor-session-persistence";

export interface EditorSessionDeps {
  fs: FileSystem;
  refreshTree: (changedPath?: string) => Promise<void>;
  addRecentFile: (path: string) => void;
  /** Lightweight callback fired after every successful save (not tree refresh). */
  onAfterSave?: () => void;
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
}

export interface UseEditorSessionReturn {
  currentDocument: SessionDocument | null;
  currentPath: string | null;
  editorDoc: string;
  activeDocumentSignal: ActiveDocumentSignal;
  setEditorDoc: React.Dispatch<React.SetStateAction<string>>;
  buffers: React.RefObject<Map<string, EditorDocumentText>>;
  liveDocs: React.RefObject<Map<string, EditorDocumentText>>;
  pipeline: SavePipeline;
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
  saveFile: () => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  closeCurrentFile: (options?: { discard?: boolean }) => Promise<boolean>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
  handleWindowCloseRequest: () => Promise<boolean>;
}

export function useEditorSession({
  fs,
  refreshTree,
  addRecentFile,
  onAfterSave,
  requestUnsavedChangesDecision,
}: EditorSessionDeps): UseEditorSessionReturn {
  const [sessionState, setSessionState] = useState<EditorSessionState>(
    () => createEditorSessionState(),
  );
  const [editorDoc, setEditorDoc] = useState("");
  const buffers = useRef<Map<string, EditorDocumentText>>(new Map());
  const liveDocs = useRef<Map<string, EditorDocumentText>>(new Map());
  const sourceMaps = useRef<Map<string, SourceMap>>(new Map());
  const activeDocumentSignal = useRef(createActiveDocumentSignal()).current;
  const stateRef = useRef<EditorSessionState>(sessionState);
  const openFileRequestRef = useRef(0);
  const writeDocumentSnapshotRef = useRef<
    (path: string, content: string, sourceMap: unknown) => Promise<string>
  >(async () => "");

  const pipeline = useMemo(() => new SavePipeline(
    (path, content, sourceMap) => writeDocumentSnapshotRef.current(path, content, sourceMap),
  ), []);

  const commitSessionState = useCallback((
    nextState: EditorSessionState,
    options?: {
      editorDoc?: string;
      syncEditorDoc?: boolean;
    },
  ) => {
    stateRef.current = nextState;
    setSessionState(nextState);

    if (options !== undefined && "editorDoc" in options) {
      setEditorDoc(options?.editorDoc ?? "");
      activeDocumentSignal.publish(nextState.currentDocument?.path ?? null);
      return;
    }

    if (options?.syncEditorDoc) {
      setEditorDoc(documentForPath(nextState.currentDocument?.path ?? null, liveDocs, buffers));
      activeDocumentSignal.publish(nextState.currentDocument?.path ?? null);
    }
  }, [activeDocumentSignal]);

  const getSessionState = useCallback((): EditorSessionState => stateRef.current, []);
  const {
    saveCurrentDocument,
    saveFile,
    handleRename,
    handleDelete,
    saveAs,
    writeDocumentSnapshot,
  } = useEditorSessionPersistence({
    fs,
    pipeline,
    refreshTree,
    addRecentFile,
    onAfterSave,
    buffers,
    liveDocs,
    sourceMaps,
    stateRef,
    commitSessionState,
    getSessionState,
  });

  writeDocumentSnapshotRef.current = (path, content, sourceMap) =>
    writeDocumentSnapshot(path, content, sourceMap as SourceMap | null);
  const sessionService = useMemo(() => createEditorSessionService({
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
  }), [
    activeDocumentSignal,
    addRecentFile,
    commitSessionState,
    fs,
    pipeline,
    refreshTree,
    requestUnsavedChangesDecision,
    saveCurrentDocument,
  ]);

  return {
    currentDocument: sessionState.currentDocument,
    currentPath: sessionState.currentDocument?.path ?? null,
    editorDoc,
    activeDocumentSignal,
    setEditorDoc,
    buffers,
    liveDocs,
    pipeline,
    getCurrentDocText: sessionService.getCurrentDocText,
    isPathOpen: sessionService.isPathOpen,
    isPathDirty: sessionService.isPathDirty,
    cancelPendingOpenFile: sessionService.cancelPendingOpenFile,
    handleDocChange: sessionService.handleDocChange,
    handleProgrammaticDocChange: sessionService.handleProgrammaticDocChange,
    setDocumentSourceMap: sessionService.setDocumentSourceMap,
    openFile: sessionService.openFile,
    openFileWithContent: sessionService.openFileWithContent,
    reloadFile: sessionService.reloadFile,
    syncExternalChange: sessionService.syncExternalChange,
    saveFile,
    createFile: sessionService.createFile,
    createDirectory: sessionService.createDirectory,
    closeCurrentFile: sessionService.closeCurrentFile,
    handleRename,
    handleDelete,
    saveAs,
    handleWindowCloseRequest: sessionService.handleWindowCloseRequest,
  };
}
