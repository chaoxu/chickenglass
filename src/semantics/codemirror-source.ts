import type { EditorState } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { TextSource, DocumentAnalysis } from "./document";
import {
  createDocumentAnalysis,
  getDocumentAnalysisRevision,
  getDocumentAnalysisRevisionInfo,
  getDocumentAnalysisSliceRevision,
  updateDocumentAnalysis,
  type DocumentAnalysisRevisionInfo,
  type DocumentAnalysisSliceName,
  type DocumentAnalysisSliceRevisions,
} from "./incremental/engine";
import { buildSemanticDelta } from "./incremental/semantic-delta";

export function editorStateTextSource(state: EditorState): TextSource {
  const doc = state.doc;
  return {
    length: doc.length,
    slice(from, to) {
      return doc.sliceString(from, to);
    },
    lineAt(pos) {
      const line = doc.lineAt(pos);
      return {
        from: line.from,
        to: line.to,
        text: line.text,
      };
    },
  };
}

function completeSyntaxTree(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state);
}

/**
 * Shared CM6 StateField that computes document semantics once per
 * document/tree change. All CM6 renderers (section numbers, sidenotes,
 * block rendering, block counters) read from this field instead of
 * independently walking the syntax tree.
 *
 * `markdown-to-html.ts` stays CM6-free and calls
 * `analyzeDocumentSemantics()` directly.
 */
export const documentAnalysisField = StateField.define<DocumentAnalysis>({
  create(state) {
    return createDocumentAnalysis(editorStateTextSource(state), completeSyntaxTree(state));
  },

  update(value, tr) {
    const delta = buildSemanticDelta(tr);
    if (!delta.docChanged && !delta.syntaxTreeChanged && !delta.globalInvalidation) {
      return value;
    }

    return updateDocumentAnalysis(
      value,
      editorStateTextSource(tr.state),
      syntaxTree(tr.state),
      delta,
    );
  },
});

export const documentSemanticsField = documentAnalysisField;

export {
  getDocumentAnalysisRevision,
  getDocumentAnalysisRevisionInfo,
  getDocumentAnalysisSliceRevision,
  type DocumentAnalysisRevisionInfo,
  type DocumentAnalysisSliceName,
  type DocumentAnalysisSliceRevisions,
};
