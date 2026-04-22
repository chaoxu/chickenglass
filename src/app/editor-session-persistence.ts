import { isTauri } from "../lib/tauri";
import { confirmAction } from "./confirm-action";
import {
  createEditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
} from "./editor-doc-change";
import {
  clearExternalDocumentConflict,
  clearSessionDocument,
  markSessionDocumentDirty,
  setExternalDocumentConflict,
} from "./editor-session-actions";
import { getCurrentSessionDocument } from "./editor-session-model";
import {
  type EditorSessionRuntime,
} from "./editor-session-runtime";
import { applySaveAsResult } from "./editor-session-save";
import type { FileSystem } from "./file-manager";
import { basename } from "./lib/utils";
import { measureAsync } from "./perf";
import { fnv1aHash, SaveWriteConflictError } from "./save-pipeline";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "./unsaved-changes";

export interface EditorSessionPersistenceOptions {
  fs: FileSystem;
  refreshTree: (changedPath?: string) => Promise<void>;
  addRecentFile: (path: string) => void;
  /** Lightweight callback fired after every successful save (not tree refresh). */
  onAfterSave?: (path: string) => void | Promise<void>;
  /** Callback fired when an old document path should no longer retain side data. */
  onAfterPathRemoved?: (path: string) => void | Promise<void>;
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
  runtime: EditorSessionRuntime;
}

export interface EditorSessionPersistence {
  saveCurrentDocument: () => Promise<boolean>;
  saveFile: () => Promise<void>;
  writeDocumentSnapshot: (
    targetPath: string,
    doc: string,
    options?: { createTargetIfMissing?: boolean; expectedBaselineHash?: string },
  ) => Promise<string>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
}

function currentDocumentText(
  path: string | null,
  runtime: EditorSessionRuntime,
): string {
  if (!path) return "";
  return editorDocumentToString(
    runtime.liveDocs.get(path)
    ?? runtime.buffers.get(path)
    ?? emptyEditorDocument,
  );
}

function remapPath(path: string, oldPath: string, newPath: string): string | null {
  if (path === oldPath) return newPath;
  if (oldPath !== "" && path.startsWith(`${oldPath}/`)) {
    return `${newPath}/${path.slice(oldPath.length + 1)}`;
  }
  return null;
}

export function createEditorSessionPersistence({
  fs,
  refreshTree,
  addRecentFile,
  onAfterSave,
  onAfterPathRemoved,
  requestUnsavedChangesDecision,
  runtime,
}: EditorSessionPersistenceOptions): EditorSessionPersistence {
  const notifyAfterSave = (path: string) => {
    if (!onAfterSave) {
      return;
    }
    void Promise.resolve().then(() => onAfterSave(path)).catch((error: unknown) => {
      console.error("[session] after-save callback failed:", error);
    });
  };

  const notifyAfterPathRemoved = (path: string) => {
    if (!onAfterPathRemoved) {
      return;
    }
    void Promise.resolve().then(() => onAfterPathRemoved(path)).catch((error: unknown) => {
      console.error("[session] after-path-removed callback failed:", error);
    });
  };

  const writeDocumentSnapshot = async (
    targetPath: string,
    doc: string,
    options?: { createTargetIfMissing?: boolean; expectedBaselineHash?: string },
  ): Promise<string> => {
    const targetExists =
      options?.createTargetIfMissing === true ? await fs.exists(targetPath) : true;
    const shouldCreateTarget =
      options?.createTargetIfMissing === true && !targetExists;
    const expectedBaselineHash = options?.expectedBaselineHash;
    const writeFileIfUnchanged = fs.writeFileIfUnchanged?.bind(fs);
    if (
      !shouldCreateTarget
      && expectedBaselineHash
      && writeFileIfUnchanged
    ) {
      const result = await measureAsync(
        "save_file.write_if_unchanged",
        () => writeFileIfUnchanged(
          targetPath,
          doc,
          expectedBaselineHash,
        ),
        {
          category: "save_file",
          detail: targetPath,
        },
      );
      if (result?.written) {
        return doc;
      }
      if (result?.currentContent !== undefined) {
        runtime.externalConflictBaselines.set(
          targetPath,
          createEditorDocumentText(result.currentContent),
        );
      }
      runtime.commit(setExternalDocumentConflict(runtime.getState(), {
        kind: result?.missing ? "deleted" : "modified",
        path: targetPath,
      }));
      throw new SaveWriteConflictError(targetPath);
    }

    if (!shouldCreateTarget && expectedBaselineHash) {
      try {
        const currentContent = await measureAsync(
          "save_file.fallback_preflight_read",
          () => fs.readFile(targetPath),
          {
            category: "save_file",
            detail: targetPath,
          },
        );
        if (fnv1aHash(currentContent) !== expectedBaselineHash) {
          runtime.externalConflictBaselines.set(
            targetPath,
            createEditorDocumentText(currentContent),
          );
          runtime.commit(setExternalDocumentConflict(runtime.getState(), {
            kind: "modified",
            path: targetPath,
          }));
          throw new SaveWriteConflictError(targetPath);
        }
      } catch (error: unknown) {
        if (error instanceof SaveWriteConflictError) {
          throw error;
        }
        runtime.commit(setExternalDocumentConflict(runtime.getState(), {
          kind: "deleted",
          path: targetPath,
        }));
        throw new SaveWriteConflictError(targetPath);
      }
    }

    await measureAsync(
      "save_file.write",
      () => (shouldCreateTarget
        ? fs.createFile(targetPath, doc)
        : fs.writeFile(targetPath, doc)),
      {
        category: "save_file",
        detail: targetPath,
      },
    );
    return doc;
  };

  const saveCurrentDocument = async (): Promise<boolean> => {
    const currentPath = runtime.getCurrentPath();
    if (!currentPath) return true;
    if (runtime.getState().externalConflict?.path === currentPath) {
      return false;
    }
    const currentDocument = runtime.getCurrentDocument();
    if (currentDocument && !currentDocument.dirty) {
      return true;
    }

    const result = await runtime.pipeline.save(currentPath, () => {
      const doc = runtime.liveDocs.get(currentPath) ?? emptyEditorDocument;
      return {
        content: editorDocumentToString(doc),
        createTargetIfMissing: runtime.newDocumentPaths.has(currentPath),
        expectedBaselineHash: runtime.getPathBaselineHash(currentPath) ?? undefined,
      };
    });

    if (result.error !== undefined) {
      if (result.error instanceof SaveWriteConflictError) {
        return false;
      }
      throw result.error;
    }

    if (result.saved && result.savedContent !== undefined) {
      const savedDoc = createEditorDocumentText(result.savedContent);
      runtime.buffers.set(currentPath, savedDoc);

      const currentRevision = runtime.pipeline.getRevision(currentPath);
      const savedRevisionIsCurrent = currentRevision === result.lastSavedRevision;
      if (savedRevisionIsCurrent) {
        runtime.liveDocs.set(currentPath, savedDoc);
      }
      runtime.externalConflictBaselines.delete(currentPath);
      runtime.newDocumentPaths.delete(currentPath);

      runtime.commit(
        clearExternalDocumentConflict(
          markSessionDocumentDirty(runtime.getState(), currentPath, !savedRevisionIsCurrent),
          currentPath,
        ),
        savedRevisionIsCurrent ? { editorDoc: result.savedContent } : undefined,
      );
      notifyAfterSave(currentPath);
      return savedRevisionIsCurrent;
    }
    return false;
  };

  const saveFile = async (): Promise<void> => {
    await saveCurrentDocument();
  };

  const renameBuffers = (oldPath: string, newPath: string): string | null => {
    const pathsToRename = new Map<string, string>();
    const addRemappedPath = (path: string) => {
      const remapped = remapPath(path, oldPath, newPath);
      if (remapped) {
        pathsToRename.set(path, remapped);
      }
    };

    for (const path of runtime.buffers.keys()) {
      addRemappedPath(path);
    }
    for (const path of runtime.liveDocs.keys()) {
      addRemappedPath(path);
    }
    const currentDocument = runtime.getCurrentDocument();
    if (currentDocument) {
      addRemappedPath(currentDocument.path);
    }

    for (const [oldDocumentPath, newDocumentPath] of pathsToRename) {
      const buffered = runtime.buffers.get(oldDocumentPath);
      const liveDoc = runtime.liveDocs.get(oldDocumentPath);

      if (buffered !== undefined) {
        runtime.buffers.delete(oldDocumentPath);
        runtime.buffers.set(newDocumentPath, buffered);
      }

      if (liveDoc !== undefined) {
        runtime.liveDocs.delete(oldDocumentPath);
        runtime.liveDocs.set(newDocumentPath, liveDoc);
      }

      runtime.pipeline.clear(oldDocumentPath);
      runtime.pipeline.initPath(
        newDocumentPath,
        editorDocumentToString(buffered ?? liveDoc ?? emptyEditorDocument),
      );
    }

    if (!currentDocument) {
      return null;
    }

    const remappedCurrentPath = remapPath(currentDocument.path, oldPath, newPath);
    if (!remappedCurrentPath) {
      return null;
    }

    const state = runtime.getState();
    const externalConflict = state.externalConflict;
    runtime.commit(
      {
        ...state,
        externalConflict:
          externalConflict && remapPath(externalConflict.path, oldPath, newPath)
            ? null
            : externalConflict,
        currentDocument: {
          ...currentDocument,
          path: remappedCurrentPath,
          name: basename(remappedCurrentPath),
        },
      },
      { editorDoc: currentDocumentText(remappedCurrentPath, runtime) },
    );

    return remappedCurrentPath;
  };

  const handleRename = async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      const oldDir = oldPath.substring(0, Math.max(0, oldPath.lastIndexOf("/")));
      const newDir = newPath.substring(0, Math.max(0, newPath.lastIndexOf("/")));
      // Same-directory rename: scoped refresh. Cross-directory: full refresh.
      await refreshTree(oldDir === newDir ? newPath : undefined);
      const oldCurrentPath = runtime.getCurrentPath();
      const renamedCurrentPath = renameBuffers(oldPath, newPath);
      if (oldCurrentPath && renamedCurrentPath && oldCurrentPath !== renamedCurrentPath) {
        notifyAfterPathRemoved(oldCurrentPath);
      }
      addRecentFile(renamedCurrentPath ?? newPath);
    } catch (e: unknown) {
      console.error("[session] rename failed:", e);
    }
  };

  const handleDelete = async (path: string) => {
    const ok = await confirmAction(`Delete "${basename(path)}"? This cannot be undone.`, {
      kind: "warning",
    });
    if (!ok) return;

    const currentDocument = getCurrentSessionDocument(runtime.getState());
    const deletingCurrentDocument = currentDocument && (
      currentDocument.path === path
      || currentDocument.path.startsWith(`${path}/`)
    );
    if (deletingCurrentDocument && currentDocument.dirty) {
      const decision = await requestUnsavedChangesDecision({
        reason: currentDocument.path === path ? "delete-file" : "delete-folder",
        currentDocument: {
          path: currentDocument.path,
          name: currentDocument.name,
        },
        target: {
          path,
          name: basename(path),
        },
      });
      if (decision === "cancel") return;
      if (decision === "save") {
        const saved = await saveCurrentDocument();
        if (!saved) return;
      }
    }

    try {
      await measureAsync("delete_file.write", () => fs.deleteFile(path), {
        category: "delete_file",
        detail: path,
      });
    } catch (e: unknown) {
      console.error("[session] delete failed:", e);
      return;
    }

    const documentAfterDeleteDecision = getCurrentSessionDocument(runtime.getState());
    if (documentAfterDeleteDecision && (
      documentAfterDeleteDecision.path === path
      || documentAfterDeleteDecision.path.startsWith(`${path}/`)
    )) {
      runtime.pipeline.clear(documentAfterDeleteDecision.path);
      runtime.buffers.delete(documentAfterDeleteDecision.path);
      runtime.liveDocs.delete(documentAfterDeleteDecision.path);
      notifyAfterPathRemoved(documentAfterDeleteDecision.path);
      runtime.commit(
        clearSessionDocument(runtime.getState(), documentAfterDeleteDecision.path),
        { editorDoc: "" },
      );
    }

    await refreshTree(path);
  };

  const saveAs = async () => {
    const currentPath = runtime.getCurrentPath();
    if (!currentPath) return;
    const liveDoc = runtime.liveDocs.get(currentPath) ?? emptyEditorDocument;
    const doc = editorDocumentToString(liveDoc);

    if (isTauri()) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const savePath = await save({
          defaultPath: currentPath,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!savePath) return;

        const { toProjectRelativePathCommand } = await import("./tauri-client/fs");
        const relativePath = await toProjectRelativePathCommand(savePath);
        await writeDocumentSnapshot(relativePath, doc, {
          createTargetIfMissing: true,
        });

        runtime.pipeline.clear(currentPath);
        runtime.pipeline.initPath(relativePath, doc);

        runtime.commit(
          applySaveAsResult({
            state: runtime.getState(),
            buffers: runtime.buffers,
            liveDocs: runtime.liveDocs,
            oldPath: currentPath,
            newPath: relativePath,
            doc: liveDoc,
          }),
          { editorDoc: doc },
        );
        notifyAfterSave(relativePath);
        if (relativePath !== currentPath) {
          notifyAfterPathRemoved(currentPath);
        }
        addRecentFile(relativePath);
        await refreshTree(relativePath);
      } catch (e: unknown) {
        console.error("[session] save-as failed:", e);
        throw e;
      }
      return;
    }

    const blob = new Blob([doc], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = basename(currentPath);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return {
    saveCurrentDocument,
    saveFile,
    writeDocumentSnapshot,
    handleRename,
    handleDelete,
    saveAs,
  };
}
