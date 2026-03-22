import { describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";
import { shouldCommitBlurredInlineEditor } from "./table-widget";

function makeEditor(cell: HTMLElement) {
  return {
    view: {} as EditorView,
    cell,
  };
}

describe("table-widget blur ownership", () => {
  it("commits when the blurred editor is still the active one", () => {
    const cell = document.createElement("td");
    const editor = makeEditor(cell);

    expect(shouldCommitBlurredInlineEditor(editor, editor, cell)).toBe(true);
  });

  it("skips commit when another cell became active before the timeout fires", () => {
    const blurredCell = document.createElement("td");
    const nextCell = document.createElement("td");
    const blurredEditor = makeEditor(blurredCell);
    const nextEditor = makeEditor(nextCell);

    expect(
      shouldCommitBlurredInlineEditor(blurredEditor, nextEditor, blurredCell),
    ).toBe(false);
  });

  it("skips commit when the original editor is already gone", () => {
    const cell = document.createElement("td");
    const editor = makeEditor(cell);

    expect(shouldCommitBlurredInlineEditor(editor, null, cell)).toBe(false);
  });
});
