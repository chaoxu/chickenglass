import type { EditorState } from "@codemirror/state";
import type { TextSource } from "./document";

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
