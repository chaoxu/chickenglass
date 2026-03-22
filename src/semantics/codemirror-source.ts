import type { EditorState } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { TextSource, DocumentAnalysis } from "./document";
import { analyzeDocumentSemantics } from "./document";

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
      return analyzeDocumentSemantics(
        editorStateTextSource(tr.state),
        syntaxTree(tr.state),
      );
    }
    return value;
  },
});

export const documentSemanticsField = documentAnalysisField;
