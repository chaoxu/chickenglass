import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";
import { createMarkdownLanguageExtensions } from "../editor/base-editor-extensions";
import { findTablesInState } from "./table-discovery";
import {
  deleteSelectedTableSelection,
  getTableDeleteRange,
  tableGridExtension,
} from "./table-grid";
import { createTestView } from "../test-utils";

const DOC = [
  "before",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "| 3 | 4 |",
  "after",
].join("\n");

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function makeView(doc = DOC): EditorView {
  return createTestView(doc, {
    extensions: [...createMarkdownLanguageExtensions(), tableGridExtension],
  });
}

function selectLines(target: EditorView, startLine: number, endLine: number): void {
  target.dispatch({
    selection: {
      anchor: target.state.doc.line(startLine).from,
      head: target.state.doc.line(endLine).to,
    },
  });
}

describe("getTableDeleteRange", () => {
  it("returns a row delete range for fully selected body rows", () => {
    view = makeView();
    const table = findTablesInState(view.state)[0];
    const row1 = view.state.doc.line(4);
    const row2 = view.state.doc.line(5);

    expect(getTableDeleteRange(view.state, table, row1.from, row2.to)).toEqual({
      from: row1.from,
      to: row2.to + 1,
      kind: "rows",
    });
  });

  it("returns null for partial body-row selections", () => {
    view = makeView();
    const table = findTablesInState(view.state)[0];
    const row1 = view.state.doc.line(4);

    expect(getTableDeleteRange(view.state, table, row1.from + 2, row1.to)).toBeNull();
  });

  it("returns a table delete range for full-table selections", () => {
    view = makeView();
    const table = findTablesInState(view.state)[0];

    expect(getTableDeleteRange(view.state, table, table.from, table.to)?.kind).toBe("table");
  });
});

describe("deleteSelectedTableSelection", () => {
  it("deletes selected body rows while preserving header and separator", () => {
    view = makeView();
    selectLines(view, 4, 5);

    expect(deleteSelectedTableSelection(view)).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "before",
      "| A | B |",
      "| --- | --- |",
      "after",
    ].join("\n"));
  });
});
