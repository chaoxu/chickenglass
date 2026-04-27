import { describe, expect, it, afterEach } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorView } from "@codemirror/view";

import {
  backspaceAtListItemStart,
  enterInListItem,
  outdentListItem,
} from "./list-outliner";
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

  it("removes an empty top-level marker without leaving indent residue", () => {
    const doc = "- one\n- ";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown()],
    });

    expect(backspaceAtListItemStart(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\n");
    expect(view.state.selection.main.head).toBe("- one\n".length);
  });
});

describe("enterInListItem", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("exits a list from an empty top-level bullet item", () => {
    const doc = "- one\n- ";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown()],
    });

    expect(enterInListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\n");
    expect(view.state.selection.main.head).toBe("- one\n".length);
  });
});

describe("outdentListItem", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("demotes a top-level item to plain paragraph text", () => {
    const doc = "- item";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown()],
    });

    expect(outdentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("item");
    expect(view.state.selection.main.head).toBe("item".length);
  });
});
