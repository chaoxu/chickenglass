import {
  applyEditorDocumentChanges,
  createEditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
  type EditorDocumentChange,
  type EditorDocumentText,
} from "../lib/editor-doc-change";
import { applySaveAsResult } from "./editor-session-save";
import type { EditorSessionState } from "./editor-session-model";
import {
  createEditorDocumentChangePositionMapping,
  type SourceMap,
} from "./source-map";
import type { SaveResult } from "./save-pipeline";
import {
  clearPathBuffers,
  clearPathBuffersKeepPipeline,
  installPathDocument,
  readDocumentText,
  renamePathBuffers,
  resetLiveDocToBuffer,
} from "./editor-session-buffers";
import type { EditorSessionRuntime } from "./editor-session-runtime";

export interface DocumentSnapshot {
  readonly content: string;
  readonly documentText: EditorDocumentText;
  readonly sourceMap: SourceMap | null;
}

export interface LiveChangeResult {
  readonly dirty: boolean;
  readonly documentText: EditorDocumentText;
}

export interface EditorSessionStore {
  readonly applyLiveChanges: (
    path: string,
    changes: readonly EditorDocumentChange[],
  ) => LiveChangeResult;
  readonly applyProgrammaticDocument: (
    path: string,
    doc: string,
    options?: { readonly updateBuffer?: boolean },
  ) => EditorDocumentText;
  readonly applySaveAsResult: (options: {
    readonly doc: EditorDocumentText;
    readonly mainDiskContent: string;
    readonly newPath: string;
    readonly oldPath: string;
    readonly state: EditorSessionState;
  }) => EditorSessionState;
  readonly clearDocument: (path: string) => void;
  readonly clearDocumentKeepPipeline: (path: string) => void;
  readonly getSourceMap: (path: string | null) => SourceMap | null;
  readonly installDocument: (options: {
    readonly content: string;
    readonly path: string;
    readonly rawContent: string;
    readonly sourceMap: SourceMap | null;
  }) => EditorDocumentText;
  readonly installSyntheticDocument: (options: {
    readonly bufferContent: string;
    readonly content: string;
    readonly path: string;
    readonly sourceMap?: SourceMap | null;
  }) => EditorDocumentText;
  readonly isSelfChange: (path: string, diskContent: string) => boolean;
  readonly markSaved: (path: string) => EditorDocumentText;
  readonly readCurrentDocumentText: () => string;
  readonly readDocumentSnapshot: (path: string) => DocumentSnapshot;
  readonly readDocumentText: (path: string | null) => string;
  readonly renameDocumentPath: (
    oldPath: string,
    newPath: string,
    rawDiskContent: string,
  ) => string;
  readonly resetLiveDocumentToBuffer: (path: string) => EditorDocumentText;
  readonly saveDocument: (path: string) => Promise<SaveResult>;
  readonly setSourceMap: (path: string, sourceMap: SourceMap | null) => void;
}

export function createEditorSessionStore(runtime: EditorSessionRuntime): EditorSessionStore {
  const readDocumentSnapshot = (path: string): DocumentSnapshot => {
    const documentText = runtime.liveDocs.get(path) ?? emptyEditorDocument;
    return {
      content: editorDocumentToString(documentText),
      documentText,
      sourceMap: runtime.sourceMaps.get(path) ?? null,
    };
  };

  return {
    applyLiveChanges: (path, changes) => {
      const previousDoc = runtime.liveDocs.get(path)
        ?? runtime.buffers.get(path)
        ?? emptyEditorDocument;
      const documentText = applyEditorDocumentChanges(previousDoc, changes);
      const sourceMap = runtime.sourceMaps.get(path);
      if (sourceMap && changes.length > 0) {
        if (sourceMap.canMapDocumentChanges(changes)) {
          sourceMap.mapThrough(createEditorDocumentChangePositionMapping(changes));
        } else {
          runtime.sourceMaps.delete(path);
        }
      }
      runtime.liveDocs.set(path, documentText);
      runtime.pipeline.bumpRevision(path);

      return {
        dirty: documentText !== (runtime.buffers.get(path) ?? emptyEditorDocument),
        documentText,
      };
    },
    applyProgrammaticDocument: (path, doc, options) => {
      const documentText = createEditorDocumentText(doc);
      if (options?.updateBuffer) {
        runtime.buffers.set(path, documentText);
      }
      runtime.liveDocs.set(path, documentText);
      return documentText;
    },
    applySaveAsResult: ({ doc, mainDiskContent, newPath, oldPath, state }) => {
      const sourceMap = runtime.sourceMaps.get(oldPath);
      if (sourceMap && oldPath !== newPath) {
        runtime.sourceMaps.delete(oldPath);
        runtime.sourceMaps.set(newPath, sourceMap);
      }

      runtime.pipeline.clear(oldPath);
      runtime.pipeline.initPath(newPath, mainDiskContent);

      return applySaveAsResult({
        state,
        buffers: runtime.buffers,
        liveDocs: runtime.liveDocs,
        oldPath,
        newPath,
        doc,
      });
    },
    clearDocument: (path) => clearPathBuffers(runtime, path),
    clearDocumentKeepPipeline: (path) => clearPathBuffersKeepPipeline(runtime, path),
    getSourceMap: (path) => path ? runtime.sourceMaps.get(path) ?? null : null,
    installDocument: ({ content, path, rawContent, sourceMap }) => {
      const documentText = createEditorDocumentText(content);
      runtime.sourceMaps.delete(path);
      installPathDocument(runtime, path, documentText, rawContent, sourceMap);
      return documentText;
    },
    installSyntheticDocument: ({ bufferContent, content, path, sourceMap = null }) => {
      const documentText = createEditorDocumentText(content);
      const bufferText = createEditorDocumentText(bufferContent);
      runtime.sourceMaps.delete(path);
      if (sourceMap) {
        runtime.sourceMaps.set(path, sourceMap);
      }
      runtime.pipeline.initPath(path, bufferContent);
      runtime.buffers.set(path, bufferText);
      runtime.liveDocs.set(path, documentText);
      return documentText;
    },
    isSelfChange: (path, diskContent) => runtime.pipeline.isSelfChange(path, diskContent),
    markSaved: (path) => {
      const documentText = runtime.liveDocs.get(path) ?? emptyEditorDocument;
      runtime.buffers.set(path, documentText);
      runtime.liveDocs.set(path, documentText);
      return documentText;
    },
    readCurrentDocumentText: () => readDocumentText(runtime, runtime.getCurrentPath()),
    readDocumentSnapshot,
    readDocumentText: (path) => readDocumentText(runtime, path),
    renameDocumentPath: (oldPath, newPath, rawDiskContent) => {
      renamePathBuffers(runtime, oldPath, newPath, rawDiskContent);
      return readDocumentText(runtime, newPath);
    },
    resetLiveDocumentToBuffer: (path) => resetLiveDocToBuffer(runtime, path),
    saveDocument: (path) =>
      runtime.pipeline.save(path, () => {
        const snapshot = readDocumentSnapshot(path);
        return {
          content: snapshot.content,
          sourceMap: snapshot.sourceMap,
        };
      }),
    setSourceMap: (path, sourceMap) => {
      if (sourceMap) {
        runtime.sourceMaps.set(path, sourceMap);
        return;
      }
      runtime.sourceMaps.delete(path);
    },
  };
}
