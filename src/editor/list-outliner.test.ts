import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import { backspaceAtListItemStart } from "./list-outliner";

function createView(doc: string, cursorPos: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [markdown()],
    }),
    parent,
  });
}

describe("backspaceAtListItemStart", () => {
  it("keeps the previous item's nested children when merging into it", () => {
    const doc = "- parent\n  - child\n- current";
    const view = createView(doc, doc.indexOf("current"));

    expect(backspaceAtListItemStart(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- parentcurrent\n  - child\n");

    view.destroy();
  });

  it("preserves the current item's nested children under the merged result", () => {
    const doc = "- parent\n- current\n  - child";
    const view = createView(doc, doc.indexOf("current"));

    expect(backspaceAtListItemStart(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- parentcurrent\n  - child");

    view.destroy();
  });
});
