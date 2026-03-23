import { describe, expect, it, afterEach } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorView } from "@codemirror/view";

import { backspaceAtListItemStart } from "./list-outliner";
import { createTestView } from "../test-utils";

describe("backspaceAtListItemStart", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("keeps the previous item's nested children when merging into it", () => {
    const doc = "- parent\n  - child\n- current";
    view = createTestView(doc, {
      cursorPos: doc.indexOf("current"),
      extensions: [markdown()],
    });

    expect(backspaceAtListItemStart(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- parentcurrent\n  - child\n");
  });

  it("preserves the current item's nested children under the merged result", () => {
    const doc = "- parent\n- current\n  - child";
    view = createTestView(doc, {
      cursorPos: doc.indexOf("current"),
      extensions: [markdown()],
    });

    expect(backspaceAtListItemStart(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- parentcurrent\n  - child");
  });
});
