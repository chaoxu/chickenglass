import { useMemo, useSyncExternalStore } from "react";
import type { FileSystem } from "../file-manager";
import {
  type ExternalDocumentConflict,
  type SessionDocument,
} from "../editor-session-model";
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
  onAfterSave?: (path: string) => void | Promise<void>;
  /** Callback fired when an old document path should no longer retain side data. */
  onAfterPathRemoved?: (path: string) => void | Promise<void>;
  /** Callback fired after explicit discard of dirty edits. */
  onAfterDiscard?: (path: string) => void | Promise<void>;
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
}

export interface UseEditorSessionReturn {
  currentDocument: SessionDocument | null;
  currentPath: string | null;
  editorDoc: string;
  externalConflict: ExternalDocumentConflict | null;
  activeDocumentSignal: ActiveDocumentSignal;
  getCurrentDocText: () => string;
  getCurrentBaselineHash: () => string | null;
  isPathOpen: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
  cancelPendingOpenFile: () => void;
  handleDocChange: (changes: readonly EditorDocumentChange[]) => void;
  handleDocumentSnapshot: (doc: string) => void;
  markCurrentDocumentDirty: () => void;
  handleProgrammaticDocChange: (path: string, doc: string) => void;
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
  hasUnresolvedExternalConflict: boolean;
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
  onAfterPathRemoved,
  onAfterDiscard,
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
    onAfterPathRemoved,
    requestUnsavedChangesDecision,
    runtime,
  }), [
    addRecentFile,
    fs,
    onAfterSave,
    onAfterPathRemoved,
    refreshTree,
    requestUnsavedChangesDecision,
    runtime,
  ]);

  runtime.setWriteDocumentSnapshot((path, snapshot) =>
    sessionPersistence.writeDocumentSnapshot(path, snapshot.content, {
      createTargetIfMissing: snapshot.createTargetIfMissing,
      expectedBaselineHash: snapshot.expectedBaselineHash,
    }),
  );
  const sessionService = useMemo(() => createEditorSessionService({
    fs,
    refreshTree,
    addRecentFile,
    requestUnsavedChangesDecision,
    runtime,
    onAfterDiscard,
    saveCurrentDocument: sessionPersistence.saveCurrentDocument,
  }), [
    addRecentFile,
    fs,
    refreshTree,
    requestUnsavedChangesDecision,
    runtime,
    onAfterDiscard,
    sessionPersistence,
  ]);

  return {
    currentDocument: snapshot.currentDocument,
    currentPath: snapshot.currentPath,
    editorDoc: snapshot.editorDoc,
    externalConflict: snapshot.externalConflict,
    activeDocumentSignal: runtime.activeDocumentSignal,
    getCurrentDocText: sessionService.getCurrentDocText,
    getCurrentBaselineHash: () =>
      snapshot.currentPath ? runtime.getPathBaselineHash(snapshot.currentPath) : null,
    isPathOpen: sessionService.isPathOpen,
    isPathDirty: sessionService.isPathDirty,
    cancelPendingOpenFile: sessionService.cancelPendingOpenFile,
    handleDocChange: sessionService.handleDocChange,
    handleDocumentSnapshot: sessionService.handleDocumentSnapshot,
    markCurrentDocumentDirty: sessionService.markCurrentDocumentDirty,
    handleProgrammaticDocChange: sessionService.handleProgrammaticDocChange,
    openFile: sessionService.openFile,
    openFileWithContent: sessionService.openFileWithContent,
    restoreDocumentFromRecovery: sessionService.restoreDocumentFromRecovery,
    reloadFile: sessionService.reloadFile,
    syncExternalChange: sessionService.syncExternalChange,
    keepExternalConflict: sessionService.keepExternalConflict,
    hasUnresolvedExternalConflict:
      snapshot.externalConflict?.path === snapshot.currentPath,
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
