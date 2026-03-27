import type { EditorState, Transaction } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { TextSource, DocumentAnalysis } from "./document";
import { analyzeDocumentSemantics } from "./document";
import { buildSemanticDelta } from "./incremental/semantic-delta";
import {
  createEquationSlice,
  mergeEquationSlice,
} from "./incremental/slices/equation-slice";
import {
  extractDirtyFencedDivWindows,
  mergeFencedDivSlice,
} from "./incremental/slices/fenced-div-slice";
import { deriveIncludeSlice } from "./incremental/slices/include-slice";
import type { DirtyWindow } from "./incremental/types";

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

function mergeLocalStructuralSlices(
  previous: DocumentAnalysis,
  next: DocumentAnalysis,
  state: EditorState,
  tr: Transaction,
  dirtyWindows: readonly DirtyWindow[],
): DocumentAnalysis {
  const doc = editorStateTextSource(state);
  const extractedDirtyWindows = extractDirtyFencedDivWindows(
    previous.fencedDivs,
    doc,
    syntaxTree(state),
    tr.changes,
    dirtyWindows,
  );
  const fencedDivs = mergeFencedDivSlice(
    previous.fencedDivs,
    tr.changes,
    extractedDirtyWindows,
  );
  const equationSlice = mergeEquationSlice(
    createEquationSlice(previous.equations),
    next.equations,
    tr.changes,
  );
  const includes = deriveIncludeSlice(
    doc,
    fencedDivs,
    previous.includes,
    tr.changes,
  );

  return {
    ...next,
    fencedDivs,
    fencedDivByFrom: new Map(fencedDivs.map((div) => [div.from, div])),
    equations: equationSlice.equations,
    equationById: equationSlice.equationById,
    includes,
    includeByFrom: new Map(includes.map((include) => [include.from, include])),
  };
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
    return analyzeDocumentSemantics(editorStateTextSource(state), syntaxTree(state));
  },

  update(value, tr) {
    if (
      tr.docChanged ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      const next = analyzeDocumentSemantics(
        editorStateTextSource(tr.state),
        syntaxTree(tr.state),
      );
      if (!tr.docChanged) {
        return next;
      }

      const delta = buildSemanticDelta(tr);
      if (delta.globalInvalidation || delta.dirtyWindows.length === 0) {
        return next;
      }

      return mergeLocalStructuralSlices(
        value,
        next,
        tr.state,
        tr,
        delta.dirtyWindows,
      );
    }
    return value;
  },
});

export const documentSemanticsField = documentAnalysisField;
