import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, StateField } from "@codemirror/state";

import type { DocumentAnalysis, TextSource } from "../semantics/document";
import {
  createDocumentAnalysis,
  getDocumentAnalysisRevision,
  getDocumentAnalysisRevisionInfo,
  getDocumentAnalysisSliceRevision,
  updateDocumentAnalysis,
  type DocumentAnalysisRevisionInfo,
  type DocumentAnalysisSliceName,
  type DocumentAnalysisSliceRevisions,
} from "../semantics/incremental/engine";
import { buildSemanticDelta } from "../semantics/incremental/semantic-delta";
import { measureSync } from "../lib/perf";

const MATERIALIZE_TEXT_AFTER_SLICE_CALLS = 8;

function lineAtInText(text: string, pos: number) {
  const safePos = Math.max(0, Math.min(pos, text.length));
  const from = Math.max(0, text.lastIndexOf("\n", Math.max(0, safePos - 1)) + 1);
  const nextBreak = text.indexOf("\n", safePos);
  const to = nextBreak === -1 ? text.length : nextBreak;
  return {
    from,
    to,
    text: text.slice(from, to),
  };
}

export function editorStateTextSource(state: EditorState): TextSource {
  const doc = state.doc;
  let materializedText: string | undefined;
  let sliceCalls = 0;

  function getMaterializedText(): string {
    if (materializedText === undefined) {
      materializedText = measureSync(
        "cm6.documentAnalysis.text.materialize",
        () => doc.toString(),
      );
    }
    return materializedText;
  }

  return {
    length: doc.length,
    slice(from, to) {
      if (materializedText !== undefined) {
        return materializedText.slice(from, to);
      }
      sliceCalls++;
      if (sliceCalls >= MATERIALIZE_TEXT_AFTER_SLICE_CALLS) {
        return getMaterializedText().slice(from, to);
      }
      return doc.sliceString(from, to);
    },
    lineAt(pos) {
      if (materializedText !== undefined) {
        return lineAtInText(materializedText, pos);
      }
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
  return measureSync(
    "cm6.documentAnalysis.ensureSyntaxTree",
    () => ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state),
  );
}

/**
 * Shared CM6 StateField that computes document semantics once per
 * document/tree change. All CM6 renderers (section numbers, sidenotes,
 * block rendering, block counters) read from this field instead of
 * independently walking the syntax tree.
 *
 * non-CM6 preview renderers stay CM6-free and call
 * `analyzeDocumentSemantics()` directly.
 */
export const documentAnalysisField = StateField.define<DocumentAnalysis>({
  create(state) {
    return measureSync("cm6.documentAnalysis.create", () =>
      createDocumentAnalysis(editorStateTextSource(state), completeSyntaxTree(state))
    );
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
