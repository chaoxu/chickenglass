import { useMemo, useSyncExternalStore } from "react";
import type { FileSystem } from "../file-manager";
import { type SessionDocument } from "../editor-session-model";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "../unsaved-changes";
import { type EditorDocumentChange } from "../editor-doc-change";
import { type ActiveDocumentSignal } from "../active-document-signal";
import {
  createEditorSessionService,
  type ExternalDocumentSyncResult,
} from "../editor-session-service";
import { createEditorSessionPersistence } from "../editor-session-persistence";
import { createEditorSessionRuntime } from "../editor-session-runtime";

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
  const sessionPersistence = useMemo(() => createEditorSessionPersistence({
    fs,
    refreshTree,
    addRecentFile,
    onAfterSave,
    runtime,
  }), [
    addRecentFile,
    fs,
    onAfterSave,
    refreshTree,
    runtime,
  ]);

  runtime.setWriteDocumentSnapshot((path, content) =>
    sessionPersistence.writeDocumentSnapshot(path, content),
  );
  const sessionService = useMemo(() => createEditorSessionService({
    fs,
    refreshTree,
    addRecentFile,
    requestUnsavedChangesDecision,
    runtime,
    saveCurrentDocument: sessionPersistence.saveCurrentDocument,
  }), [
    addRecentFile,
    fs,
    refreshTree,
    requestUnsavedChangesDecision,
    runtime,
    sessionPersistence,
  ]);

  return {
    currentDocument: snapshot.currentDocument,
    currentPath: snapshot.currentPath,
    editorDoc: snapshot.editorDoc,
    activeDocumentSignal: runtime.activeDocumentSignal,
    getCurrentDocText: sessionService.getCurrentDocText,
    isPathOpen: sessionService.isPathOpen,
    isPathDirty: sessionService.isPathDirty,
    cancelPendingOpenFile: sessionService.cancelPendingOpenFile,
    handleDocChange: sessionService.handleDocChange,
    handleDocumentSnapshot: sessionService.handleDocumentSnapshot,
    markCurrentDocumentDirty: sessionService.markCurrentDocumentDirty,
    handleProgrammaticDocChange: sessionService.handleProgrammaticDocChange,
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
