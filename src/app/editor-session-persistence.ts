import { isTauri } from "../lib/tauri";
import {
  clearSessionDocument,
  markSessionDocumentDirty,
  renameSessionDocument,
} from "./editor-session-actions";
import { getCurrentSessionDocument } from "./editor-session-model";
import {
  createEditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
} from "./editor-doc-change";
import { applySaveAsResult } from "./editor-session-save";
import {
  type EditorSessionRuntime,
} from "./editor-session-runtime";
import type { FileSystem } from "./file-manager";
import { basename } from "./lib/utils";
import { measureAsync } from "./perf";
import { confirmAction } from "./confirm-action";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "./unsaved-changes";

export interface EditorSessionPersistenceOptions {
  fs: FileSystem;
  refreshTree: (changedPath?: string) => Promise<void>;
  addRecentFile: (path: string) => void;
  /** Lightweight callback fired after every successful save (not tree refresh). */
  onAfterSave?: () => void;
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
    options?: { createTargetIfMissing?: boolean },
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

export function createEditorSessionPersistence({
  fs,
  refreshTree,
  addRecentFile,
  onAfterSave,
  requestUnsavedChangesDecision,
  runtime,
}: EditorSessionPersistenceOptions): EditorSessionPersistence {
  const writeDocumentSnapshot = async (
    targetPath: string,
    doc: string,
    options?: { createTargetIfMissing?: boolean },
  ): Promise<string> => {
    const targetExists =
      options?.createTargetIfMissing === true ? await fs.exists(targetPath) : true;
    const shouldCreateTarget =
      options?.createTargetIfMissing === true && !targetExists;
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

    const result = await runtime.pipeline.save(currentPath, () => {
      const doc = runtime.liveDocs.get(currentPath) ?? emptyEditorDocument;
      return { content: editorDocumentToString(doc) };
    });

    if (result.saved && result.savedContent !== undefined) {
      const savedDoc = createEditorDocumentText(result.savedContent);
      runtime.buffers.set(currentPath, savedDoc);

      const currentRevision = runtime.pipeline.getRevision(currentPath);
      const savedRevisionIsCurrent = currentRevision === result.lastSavedRevision;
      if (savedRevisionIsCurrent) {
        runtime.liveDocs.set(currentPath, savedDoc);
      }

      runtime.commit(
        markSessionDocumentDirty(runtime.getState(), currentPath, !savedRevisionIsCurrent),
        savedRevisionIsCurrent ? { editorDoc: result.savedContent } : undefined,
      );
      onAfterSave?.();
      return savedRevisionIsCurrent;
    }
    return false;
  };

  const saveFile = async (): Promise<void> => {
    await saveCurrentDocument();
  };

  const renameBuffers = (oldPath: string, newPath: string) => {
    const buffered = runtime.buffers.get(oldPath);
    if (buffered !== undefined) {
      runtime.buffers.delete(oldPath);
      runtime.buffers.set(newPath, buffered);
    }

    const liveDoc = runtime.liveDocs.get(oldPath);
    if (liveDoc !== undefined) {
      runtime.liveDocs.delete(oldPath);
      runtime.liveDocs.set(newPath, liveDoc);
    }

    runtime.pipeline.clear(oldPath);
    runtime.pipeline.initPath(
      newPath,
      editorDocumentToString(liveDoc ?? buffered ?? emptyEditorDocument),
    );

    runtime.commit(
      renameSessionDocument(runtime.getState(), oldPath, newPath, basename(newPath)),
      runtime.getCurrentPath() === oldPath
        ? { editorDoc: currentDocumentText(newPath, runtime) }
        : undefined,
    );
  };

  const handleRename = async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      const oldDir = oldPath.substring(0, Math.max(0, oldPath.lastIndexOf("/")));
      const newDir = newPath.substring(0, Math.max(0, newPath.lastIndexOf("/")));
      // Same-directory rename: scoped refresh. Cross-directory: full refresh.
      await refreshTree(oldDir === newDir ? newPath : undefined);
      renameBuffers(oldPath, newPath);
      addRecentFile(newPath);
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
      } else {
        const savedDoc = runtime.buffers.get(currentDocument.path) ?? emptyEditorDocument;
        runtime.liveDocs.set(currentDocument.path, savedDoc);
        runtime.commit(
          markSessionDocumentDirty(runtime.getState(), currentDocument.path, false),
          { editorDoc: editorDocumentToString(savedDoc) },
        );
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
