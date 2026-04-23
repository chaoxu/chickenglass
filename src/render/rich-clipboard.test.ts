import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditor, setEditorMode } from "../editor/editor";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function createClipboardView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = createEditor({ parent, doc });
  return view;
}

function select(target: EditorView, from: number, to: number): void {
  target.dispatch({
    selection: { anchor: from, head: to },
  });
}

function copiedText(target: EditorView): string {
  const content: string[] = [];
  const nonEmptyRanges = target.state.selection.ranges.filter((range) => !range.empty);

  if (nonEmptyRanges.length > 0) {
    for (const range of nonEmptyRanges) {
      content.push(target.state.sliceDoc(range.from, range.to));
    }
  } else {
    let upto = -1;
    for (const { from } of target.state.selection.ranges) {
      const line = target.state.doc.lineAt(from);
      if (line.number <= upto) continue;
      content.push(target.state.sliceDoc(line.from, Math.min(target.state.doc.length, line.to + 1)));
      upto = line.number;
    }
  }

  let text = content.join(target.state.lineBreak);
  for (const filter of target.state.facet(EditorView.clipboardOutputFilter)) {
    text = filter(text, target.state);
  }
  return text;
}

describe("rich clipboard output filter", () => {
  it("balances copied multi-line fenced div fragments", () => {
    const doc = [
      '::: {.theorem title="Title"}',
      "Alpha",
      "Beta",
      ":::",
    ].join("\n");
    const target = createClipboardView(doc);

    select(target, 0, doc.indexOf("\n:::"));

    expect(copiedText(target)).toBe(doc);
  });

  it("leaves noncanonical single-line fenced div fragments literal", () => {
    const doc = "::: {.theorem} Title :::";
    const target = createClipboardView(doc);

    select(target, 0, doc.indexOf(" :::"));

    expect(copiedText(target)).toBe("::: {.theorem} Title");
  });

  it("preserves the original code-fence count when balancing copies", () => {
    const doc = [
      "````js",
      "const x = 1;",
      "````",
    ].join("\n");
    const target = createClipboardView(doc);

    select(target, 0, doc.indexOf("\n````"));

    expect(copiedText(target)).toBe(doc);
  });

  it("keeps body-only selections literal", () => {
    const doc = [
      '::: {.theorem title="Title"}',
      "Alpha",
      "Beta",
      ":::",
    ].join("\n");
    const target = createClipboardView(doc);

    select(target, doc.indexOf("Alpha"), doc.indexOf("\n:::"));

    expect(copiedText(target)).toBe("Alpha\nBeta");
  });

  it("closes nested blocks from inner to outer", () => {
    const doc = [
      '::: {.theorem title="Outer"}',
      '::: {.proof title="Inner"}',
      "Work",
      ":::",
      ":::",
    ].join("\n");
    const target = createClipboardView(doc);

    select(target, 0, doc.indexOf("\n:::\n:::"));

    expect(copiedText(target)).toBe(doc);
  });

  it("keeps source-mode copy literal", () => {
    const doc = [
      '::: {.theorem title="Title"}',
      "Alpha",
      "Beta",
      ":::",
    ].join("\n");
    const target = createClipboardView(doc);

    select(target, 0, doc.indexOf("\n:::"));
    setEditorMode(target, "source");

    expect(copiedText(target)).toBe([
      '::: {.theorem title="Title"}',
      "Alpha",
      "Beta",
    ].join("\n"));
  });
});
