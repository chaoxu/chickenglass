import { isTauri } from "../lib/tauri";
import {
  clearSessionDocument,
  markSessionDocumentDirty,
  renameSessionDocument,
} from "./editor-session-actions";
import { getCurrentSessionDocument } from "./editor-session-model";
import {
  editorDocumentToString,
  emptyEditorDocument,
} from "../lib/editor-doc-change";
import { applySaveAsResult } from "./editor-session-save";
import { buildProjectedWritePlan } from "./editor-session-write-plan";
import {
  type EditorSessionRuntime,
} from "./editor-session-runtime";
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
  runtime,
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

    const result = await runtime.pipeline.save(currentPath, () => {
      const doc = runtime.liveDocs.get(currentPath) ?? emptyEditorDocument;
      const sourceMap = runtime.sourceMaps.get(currentPath) ?? null;
      return { content: editorDocumentToString(doc), sourceMap };
    });

    if (result.saved) {
      const doc = runtime.liveDocs.get(currentPath) ?? emptyEditorDocument;
      runtime.buffers.set(currentPath, doc);
      runtime.liveDocs.set(currentPath, doc);
      runtime.commit(
        markSessionDocumentDirty(runtime.getState(), currentPath, false),
        { editorDoc: editorDocumentToString(doc) },
      );
      onAfterSave?.();
    }
    return result.saved;
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

    const sourceMap = runtime.sourceMaps.get(oldPath);
    if (sourceMap) {
      runtime.sourceMaps.delete(oldPath);
      runtime.sourceMaps.set(newPath, sourceMap);
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
    if (currentDocument && (
      currentDocument.path === path
      || currentDocument.path.startsWith(`${path}/`)
    )) {
      runtime.buffers.delete(currentDocument.path);
      runtime.liveDocs.delete(currentDocument.path);
      runtime.sourceMaps.delete(currentDocument.path);
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
    const liveDoc = runtime.liveDocs.get(currentPath) ?? emptyEditorDocument;
    const doc = editorDocumentToString(liveDoc);
    const sourceMap = runtime.sourceMaps.get(currentPath) ?? null;

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
        await writeDocumentSnapshot(relativePath, doc, sourceMap, {
          createTargetIfMissing: true,
        });

        if (sourceMap && currentPath !== relativePath) {
          runtime.sourceMaps.delete(currentPath);
          runtime.sourceMaps.set(relativePath, sourceMap);
        }

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
