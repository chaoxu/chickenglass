import { isTauri } from "../lib/tauri";
import { isSameOrDescendantProjectPath } from "../lib/project-paths";
import {
  clearSessionDocument,
  markSessionDocumentDirty,
  renameSessionDocument,
} from "./editor-session-actions";
import { getCurrentSessionDocument } from "./editor-session-model";
import { editorDocumentToString } from "../lib/editor-doc-change";
import { buildProjectedWritePlan } from "./editor-session-write-plan";
import {
  type EditorSessionRuntime,
} from "./editor-session-runtime";
import type { EditorSessionStore } from "./editor-session-store";
import type { FileSystem } from "./file-manager";
import { basename } from "./lib/utils";
import { measureAsync } from "./perf";
import type { SourceMap } from "./source-map";
import { confirmAction } from "./confirm-action";

export interface EditorSessionPersistenceOptions {
  fs: FileSystem;
  refreshTree: (changedPath?: string) => Promise<void>;
  addRecentFile: (path: string) => void;
  /** Lightweight callback fired after every successful save (not tree refresh). */
  onAfterSave?: () => void;
  runtime: EditorSessionRuntime;
  store: EditorSessionStore;
}

export interface EditorSessionPersistence {
  saveCurrentDocument: () => Promise<boolean>;
  saveFile: () => Promise<void>;
  writeDocumentSnapshot: (
    targetPath: string,
    doc: string,
    sourceMap: SourceMap | null,
    options?: { createTargetIfMissing?: boolean },
  ) => Promise<string>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
}

export function createEditorSessionPersistence({
  fs,
  refreshTree,
  addRecentFile,
  onAfterSave,
  runtime,
  store,
}: EditorSessionPersistenceOptions): EditorSessionPersistence {
  const writeDocumentSnapshot = async (
    targetPath: string,
    doc: string,
    sourceMap: SourceMap | null,
    options?: { createTargetIfMissing?: boolean },
  ): Promise<string> => {
    const writes = buildProjectedWritePlan(targetPath, doc, sourceMap);
    const targetExists =
      options?.createTargetIfMissing === true ? await fs.exists(targetPath) : true;

    let mainDiskContent = doc;
    for (const write of writes) {
      const shouldCreateTarget =
        options?.createTargetIfMissing === true
        && write.path === targetPath
        && !targetExists;
      await measureAsync(
        "save_file.write",
        () => (shouldCreateTarget
          ? fs.createFile(write.path, write.content)
          : fs.writeFile(write.path, write.content)),
        {
          category: "save_file",
          detail: write.path,
        },
      );
      if (write.path === targetPath) {
        mainDiskContent = write.content;
      }
    }
    return mainDiskContent;
  };

  const saveCurrentDocument = async (): Promise<boolean> => {
    const currentPath = runtime.getCurrentPath();
    if (!currentPath) return true;

    const result = await store.saveDocument(currentPath);

    if (result.saved) {
      const doc = store.markSaved(currentPath);
      runtime.commit(
        markSessionDocumentDirty(runtime.getState(), currentPath, false),
        { editorDoc: editorDocumentToString(doc) },
      );
      onAfterSave?.();
    }
    return result.saved;
  };

  const saveFile = async (): Promise<void> => {
    const saved = await saveCurrentDocument();
    if (!saved) {
      throw new Error("Save did not complete");
    }
  };

  const renameBuffers = (oldPath: string, newPath: string, rawDiskContent: string) => {
    const editorDoc = store.renameDocumentPath(oldPath, newPath, rawDiskContent);

    runtime.commit(
      renameSessionDocument(runtime.getState(), oldPath, newPath, basename(newPath)),
      runtime.getCurrentPath() === oldPath
        ? { editorDoc }
        : undefined,
    );
  };

  const handleRename = async (oldPath: string, newPath: string) => {
    try {
      const rawDiskContent = await fs.readFile(oldPath);
      await fs.renameFile(oldPath, newPath);
      const oldDir = oldPath.substring(0, Math.max(0, oldPath.lastIndexOf("/")));
      const newDir = newPath.substring(0, Math.max(0, newPath.lastIndexOf("/")));
      // Same-directory rename: scoped refresh. Cross-directory: full refresh.
      await refreshTree(oldDir === newDir ? newPath : undefined);
      renameBuffers(oldPath, newPath, rawDiskContent);
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

    try {
      await measureAsync("delete_file.write", () => fs.deleteFile(path), {
        category: "delete_file",
        detail: path,
      });
    } catch (e: unknown) {
      console.error("[session] delete failed:", e);
      return;
    }

    const currentDocument = getCurrentSessionDocument(runtime.getState());
    if (currentDocument && isSameOrDescendantProjectPath(currentDocument.path, path)) {
      store.clearDocumentKeepPipeline(currentDocument.path);
      runtime.commit(
        clearSessionDocument(runtime.getState(), currentDocument.path),
        { editorDoc: "" },
      );
    }

    await refreshTree(path);
  };

  const saveAs = async () => {
    const currentPath = runtime.getCurrentPath();
    if (!currentPath) return;
    const snapshot = store.readDocumentSnapshot(currentPath);
    const doc = snapshot.content;

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
        const mainDiskContent = await writeDocumentSnapshot(relativePath, doc, snapshot.sourceMap, {
          createTargetIfMissing: true,
        });

        runtime.commit(
          store.applySaveAsResult({
            state: runtime.getState(),
            oldPath: currentPath,
            newPath: relativePath,
            doc: snapshot.documentText,
            mainDiskContent,
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
