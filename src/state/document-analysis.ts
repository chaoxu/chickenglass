import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { type EditorState, StateField, type Transaction } from "@codemirror/state";

import type { DocumentAnalysis, TextSource } from "../semantics/document";
import {
  createDocumentAnalysisSnapshot,
  type DocumentAnalysisSnapshot,
  getDocumentAnalysisRevision,
  getDocumentAnalysisRevisionInfo,
  getDocumentAnalysisSliceRevision,
  updateDocumentAnalysisSnapshot,
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

function updateDocumentAnalysisForTransaction(
  value: DocumentAnalysisSnapshot,
  tr: Transaction,
): DocumentAnalysisSnapshot {
  const delta = buildSemanticDelta(tr);
  if (!delta.docChanged && !delta.syntaxTreeChanged && !delta.globalInvalidation) {
    return value;
  }

  return measureSync("cm6.documentAnalysis.update", () => {
    const doc = editorStateTextSource(tr.state);
    const tree = syntaxTree(tr.state);
    return measureSync("cm6.documentAnalysis.update.sliceMerge", () =>
      updateDocumentAnalysisSnapshot(value, doc, tree, delta, {
        isSyntaxTreeAvailable: (to) => syntaxTreeAvailable(tr.state, to),
      })
    );
  });
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
export const documentAnalysisField = StateField.define<DocumentAnalysisSnapshot>({
  create(state) {
    return measureSync("cm6.documentAnalysis.create", () =>
      createDocumentAnalysisSnapshot(editorStateTextSource(state), completeSyntaxTree(state))
    );
  },

  update(value, tr) {
    return updateDocumentAnalysisForTransaction(value, tr);
  },
});

export const documentSemanticsField = documentAnalysisField;

export function documentAnalysisFromSnapshot(
  snapshot: DocumentAnalysisSnapshot | null | undefined,
): DocumentAnalysis | undefined {
  return snapshot?.analysis;
}

export {
  getDocumentAnalysisRevision,
  getDocumentAnalysisRevisionInfo,
  getDocumentAnalysisSliceRevision,
  type DocumentAnalysisRevisionInfo,
  type DocumentAnalysisSliceName,
  type DocumentAnalysisSliceRevisions,
};
