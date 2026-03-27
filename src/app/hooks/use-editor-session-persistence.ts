import { useCallback } from "react";
import type { RefObject } from "react";
import { isTauri } from "../../lib/tauri";
import {
  clearSessionDocument,
  markSessionDocumentDirty,
  renameSessionDocument,
} from "../editor-session-actions";
import {
  getCurrentSessionDocument,
  type EditorSessionState,
} from "../editor-session-model";
import { applySaveAsResult } from "../editor-session-save";
import { buildProjectedWritePlan } from "../editor-session-write-plan";
import type { FileSystem } from "../file-manager";
import { basename } from "../lib/utils";
import { measureAsync } from "../perf";
import type { SourceMap } from "../source-map";
import { confirmAction } from "../confirm-action";

interface CommitSessionStateOptions {
  editorDoc?: string;
  syncEditorDoc?: boolean;
}

type CommitSessionState = (
  nextState: EditorSessionState,
  options?: CommitSessionStateOptions,
) => void;

interface UseEditorSessionPersistenceOptions {
  fs: FileSystem;
  refreshTree: () => Promise<void>;
  addRecentFile: (path: string) => void;
  buffers: RefObject<Map<string, string>>;
  liveDocs: RefObject<Map<string, string>>;
  sourceMaps: RefObject<Map<string, SourceMap>>;
  stateRef: RefObject<EditorSessionState>;
  commitSessionState: CommitSessionState;
  getSessionState: () => EditorSessionState;
}

export interface UseEditorSessionPersistenceReturn {
  saveCurrentDocument: () => Promise<boolean>;
  saveFile: () => Promise<void>;
  handleRename: (oldPath: string, newPath: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  saveAs: () => Promise<void>;
}

function documentForPath(
  path: string | null,
  liveDocs: RefObject<Map<string, string>>,
  buffers: RefObject<Map<string, string>>,
): string {
  if (!path) return "";
  return liveDocs.current.get(path) ?? buffers.current.get(path) ?? "";
}

export function useEditorSessionPersistence({
  fs,
  refreshTree,
  addRecentFile,
  buffers,
  liveDocs,
  sourceMaps,
  stateRef,
  commitSessionState,
  getSessionState,
}: UseEditorSessionPersistenceOptions): UseEditorSessionPersistenceReturn {
  const writeDocumentSnapshot = useCallback(async (
    targetPath: string,
    doc: string,
    sourceMap: SourceMap | null,
    options?: { createTargetIfMissing?: boolean },
  ): Promise<void> => {
    const writes = buildProjectedWritePlan(targetPath, doc, sourceMap);
    const targetExists =
      options?.createTargetIfMissing === true ? await fs.exists(targetPath) : true;

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
    }
  }, [fs]);

  const saveCurrentDocument = useCallback(async (): Promise<boolean> => {
    const currentPath = getSessionState().currentDocument?.path;
    if (!currentPath) return true;

    const doc = liveDocs.current.get(currentPath) ?? "";
    const sourceMap = sourceMaps.current.get(currentPath) ?? null;
    try {
      await writeDocumentSnapshot(currentPath, doc, sourceMap);
      buffers.current.set(currentPath, doc);
      liveDocs.current.set(currentPath, doc);
      commitSessionState(
        markSessionDocumentDirty(getSessionState(), currentPath, false),
        { editorDoc: doc },
      );
      return true;
    } catch (e: unknown) {
      console.error("[session] save failed:", e);
      return false;
    }
  }, [
    buffers,
    commitSessionState,
    getSessionState,
    liveDocs,
    sourceMaps,
    writeDocumentSnapshot,
  ]);

  const saveFile = useCallback(async (): Promise<void> => {
    await saveCurrentDocument();
  }, [saveCurrentDocument]);

  const renameBuffers = useCallback((oldPath: string, newPath: string) => {
    const buffered = buffers.current.get(oldPath);
    if (buffered !== undefined) {
      buffers.current.delete(oldPath);
      buffers.current.set(newPath, buffered);
    }

    const liveDoc = liveDocs.current.get(oldPath);
    if (liveDoc !== undefined) {
      liveDocs.current.delete(oldPath);
      liveDocs.current.set(newPath, liveDoc);
    }

    const sourceMap = sourceMaps.current.get(oldPath);
    if (sourceMap) {
      sourceMaps.current.delete(oldPath);
      sourceMaps.current.set(newPath, sourceMap);
    }

    commitSessionState(
      renameSessionDocument(stateRef.current, oldPath, newPath, basename(newPath)),
      stateRef.current.currentDocument?.path === oldPath
        ? { editorDoc: documentForPath(newPath, liveDocs, buffers) }
        : undefined,
    );
  }, [buffers, commitSessionState, liveDocs, sourceMaps, stateRef]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      await refreshTree();
      renameBuffers(oldPath, newPath);
      addRecentFile(newPath);
    } catch (e: unknown) {
      console.error("[session] rename failed:", e);
    }
  }, [addRecentFile, fs, refreshTree, renameBuffers]);

  const handleDelete = useCallback(async (path: string) => {
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

    const currentDocument = getCurrentSessionDocument(stateRef.current);
    if (currentDocument && (
      currentDocument.path === path
      || currentDocument.path.startsWith(`${path}/`)
    )) {
      buffers.current.delete(currentDocument.path);
      liveDocs.current.delete(currentDocument.path);
      sourceMaps.current.delete(currentDocument.path);
      commitSessionState(
        clearSessionDocument(stateRef.current, currentDocument.path),
        { editorDoc: "" },
      );
    }

    await refreshTree();
  }, [buffers, commitSessionState, fs, liveDocs, refreshTree, sourceMaps, stateRef]);

  const saveAs = useCallback(async () => {
    const currentPath = getSessionState().currentDocument?.path;
    if (!currentPath) return;
    const doc = liveDocs.current.get(currentPath) ?? "";
    const sourceMap = sourceMaps.current.get(currentPath) ?? null;

    if (isTauri()) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const savePath = await save({
          defaultPath: currentPath,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!savePath) return;

        const { toProjectRelativePathCommand } = await import("../tauri-client/fs");
        const relativePath = await toProjectRelativePathCommand(savePath);
        await writeDocumentSnapshot(relativePath, doc, sourceMap, {
          createTargetIfMissing: true,
        });

        if (sourceMap && currentPath !== relativePath) {
          sourceMaps.current.delete(currentPath);
          sourceMaps.current.set(relativePath, sourceMap);
        }

        commitSessionState(
          applySaveAsResult({
            state: getSessionState(),
            buffers: buffers.current,
            liveDocs: liveDocs.current,
            oldPath: currentPath,
            newPath: relativePath,
            doc,
          }),
          { editorDoc: doc },
        );
        addRecentFile(relativePath);
        await refreshTree();
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
  }, [
    addRecentFile,
    buffers,
    commitSessionState,
    getSessionState,
    liveDocs,
    refreshTree,
    sourceMaps,
    writeDocumentSnapshot,
  ]);

  return {
    saveCurrentDocument,
    saveFile,
    handleRename,
    handleDelete,
    saveAs,
  };
}
