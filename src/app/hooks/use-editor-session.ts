import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { FileSystem } from "../file-manager";
import { type SessionDocument } from "../editor-session-model";
import type { SourceMap } from "../source-map";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "../unsaved-changes";
import { type EditorDocumentChange } from "../../lib/editor-doc-change";
import { type ActiveDocumentSignal } from "../active-document-signal";
import {
  createEditorSessionService,
  type ExternalDocumentSyncResult,
} from "../editor-session-service";
import { createEditorSessionPersistence } from "../editor-session-persistence";
import { createEditorSessionRuntime } from "../editor-session-runtime";
import { createEditorSessionStore } from "../editor-session-store";

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
  const runtime = useMemo(() => createEditorSessionRuntime(), []);
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const store = useMemo(() => createEditorSessionStore(runtime), [runtime]);
  const sessionPersistence = useMemo(() => createEditorSessionPersistence({
    fs,
    refreshTree,
    addRecentFile,
    onAfterSave,
    runtime,
    store,
  }), [
    addRecentFile,
    fs,
    onAfterSave,
    refreshTree,
    runtime,
    store,
  ]);

  useEffect(() => {
    runtime.setWriteDocumentSnapshot((path, content, sourceMap) =>
      sessionPersistence.writeDocumentSnapshot(path, content, sourceMap as SourceMap | null),
    );
  }, [runtime, sessionPersistence]);
  const sessionService = useMemo(() => createEditorSessionService({
    fs,
    refreshTree,
    addRecentFile,
    requestUnsavedChangesDecision,
    runtime,
    store,
    saveCurrentDocument: sessionPersistence.saveCurrentDocument,
  }), [
    addRecentFile,
    fs,
    refreshTree,
    requestUnsavedChangesDecision,
    runtime,
    sessionPersistence,
    store,
  ]);

  return {
    currentDocument: snapshot.currentDocument,
    currentPath: snapshot.currentPath,
    editorDoc: snapshot.editorDoc,
    activeDocumentSignal: runtime.activeDocumentSignal,
    getCurrentDocText: sessionService.getCurrentDocText,
    getCurrentSourceMap: sessionService.getCurrentSourceMap,
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
    saveFile: sessionPersistence.saveFile,
    createFile: sessionService.createFile,
    createDirectory: sessionService.createDirectory,
    closeCurrentFile: sessionService.closeCurrentFile,
    handleRename: sessionPersistence.handleRename,
    handleDelete: sessionPersistence.handleDelete,
    saveAs: sessionPersistence.saveAs,
    handleWindowCloseRequest: sessionService.handleWindowCloseRequest,
  };
}
