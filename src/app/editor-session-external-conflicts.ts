import {
  clearExternalDocumentConflict,
  setExternalDocumentConflict,
} from "./editor-session-actions";
import type { FileSystem } from "./file-manager";
import {
  createEditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
} from "./editor-doc-change";
import { createExternalConflictMergeDocument } from "./external-conflict-merge";
import type { EditorSessionRuntime } from "./editor-session-runtime";

interface ExternalConflictActionsOptions {
  fs: FileSystem;
  refreshTree: (changedPath?: string) => Promise<void>;
  runtime: EditorSessionRuntime;
}

export interface ExternalConflictActions {
  keepExternalConflict: (path: string) => Promise<void>;
  mergeExternalConflict: (path: string) => Promise<void>;
}

export function createExternalConflictActions({
  fs,
  refreshTree,
  runtime,
}: ExternalConflictActionsOptions): ExternalConflictActions {
  const keepExternalConflict = async (path: string): Promise<void> => {
    const conflict = runtime.getState().externalConflict;
    if (conflict?.path !== path) {
      return;
    }

    if (conflict.kind === "modified") {
      try {
        const diskDoc = runtime.externalConflictBaselines.get(path)
          ?? createEditorDocumentText(await fs.readFile(path));
        const diskContent = editorDocumentToString(diskDoc);
        const liveDoc = runtime.liveDocs.get(path) ?? diskDoc;
        runtime.buffers.set(path, diskDoc);
        runtime.clearExternalConflictBaseline(path);
        runtime.clearNewDocumentPath(path);
        runtime.pipeline.initPath(path, diskContent);
        runtime.commit(
          clearExternalDocumentConflict(
            runtime.setPathDirty(path, !liveDoc.eq(diskDoc)),
            path,
          ),
        );
        return;
      } catch (_error: unknown) {
        // If the external baseline can no longer be read, treat the conflict as a deletion.
        runtime.commit(setExternalDocumentConflict(runtime.getState(), {
          kind: "deleted",
          path,
        }));
        return;
      }
    }

    const startRevision = runtime.pipeline.getRevision(path);
    const liveDoc = runtime.liveDocs.get(path) ?? emptyEditorDocument;
    const content = editorDocumentToString(liveDoc);
    try {
      if (await fs.exists(path)) {
        const diskContent = await fs.readFile(path);
        runtime.setExternalConflictBaseline(path, createEditorDocumentText(diskContent));
        runtime.commit(setExternalDocumentConflict(runtime.getState(), {
          kind: "modified",
          path,
        }));
        return;
      }
      await fs.createFile(path, content);
      const savedDoc = createEditorDocumentText(content);
      const revisionAdvanced = runtime.pipeline.getRevision(path) !== startRevision;
      runtime.buffers.set(path, savedDoc);
      if (!revisionAdvanced) {
        runtime.liveDocs.set(path, savedDoc);
      }
      runtime.clearExternalConflictBaseline(path);
      runtime.clearNewDocumentPath(path);
      runtime.pipeline.initPath(path, content);
      if (revisionAdvanced) {
        runtime.pipeline.bumpRevision(path);
      }
      runtime.commit(
        clearExternalDocumentConflict(
          runtime.setPathDirty(path, revisionAdvanced),
          path,
        ),
        !revisionAdvanced && runtime.getCurrentPath() === path ? { editorDoc: content } : undefined,
      );
      await refreshTree(path);
    } catch (error: unknown) {
      try {
        if (await fs.exists(path)) {
          const diskContent = await fs.readFile(path);
          runtime.setExternalConflictBaseline(path, createEditorDocumentText(diskContent));
          runtime.commit(setExternalDocumentConflict(runtime.getState(), {
            kind: "modified",
            path,
          }));
          return;
        }
      } catch (_recheckError: unknown) {
        // Preserve the deleted conflict below when the recheck cannot read a usable replacement baseline.
      }
      console.error("[session] failed to restore deleted conflicted file:", path, error);
      runtime.commit(setExternalDocumentConflict(runtime.getState(), {
        kind: "deleted",
        path,
      }));
    }
  };

  const mergeExternalConflict = async (path: string): Promise<void> => {
    const conflict = runtime.getState().externalConflict;
    if (conflict?.path !== path) {
      return;
    }

    if (conflict.kind === "deleted") {
      await keepExternalConflict(path);
      return;
    }

    try {
      const diskDoc = runtime.externalConflictBaselines.get(path)
        ?? createEditorDocumentText(await fs.readFile(path));
      const baseDoc = runtime.buffers.get(path) ?? emptyEditorDocument;
      const localDoc = runtime.liveDocs.get(path) ?? baseDoc;
      const diskContent = editorDocumentToString(diskDoc);
      const merged = createExternalConflictMergeDocument({
        base: editorDocumentToString(baseDoc),
        disk: diskContent,
        local: editorDocumentToString(localDoc),
      });
      const mergedDoc = createEditorDocumentText(merged.content);
      const dirty = !mergedDoc.eq(diskDoc);

      runtime.buffers.set(path, diskDoc);
      runtime.liveDocs.set(path, mergedDoc);
      runtime.clearExternalConflictBaseline(path);
      runtime.clearNewDocumentPath(path);
      runtime.pipeline.initPath(path, diskContent);
      if (dirty) {
        runtime.pipeline.bumpRevision(path);
      }
      runtime.activeDocumentSignal.publish(path);
      runtime.commit(
        clearExternalDocumentConflict(
          runtime.setPathDirty(path, dirty),
          path,
        ),
        runtime.getCurrentPath() === path ? { editorDoc: merged.content } : undefined,
      );
    } catch (_error: unknown) {
      // If the disk side of the merge is gone, preserve the local doc as a deleted-file conflict.
      runtime.commit(setExternalDocumentConflict(runtime.getState(), {
        kind: "deleted",
        path,
      }));
    }
  };

  return {
    keepExternalConflict,
    mergeExternalConflict,
  };
}
