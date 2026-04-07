import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorView } from "@codemirror/view";
import { collectNodes, collectNodeRangesExcludingCursor } from "./node-collection";
import { decorationHidden } from "./decoration-core";
import {
  createEditorState,
  createTestView,
} from "../test-utils";

describe("collectNodes", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("collects nodes of matching types from EditorState", () => {
    const state = createEditorState("# Hello\n\nworld", {
      extensions: markdown(),
    });
    const nodes = collectNodes(state, new Set(["ATXHeading1"]));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({
      type: "ATXHeading1",
      from: 0,
      to: 7,
    });
  });

  it("returns empty array when no types match", () => {
    const state = createEditorState("plain text", {
      extensions: markdown(),
    });
    const nodes = collectNodes(state, new Set(["FencedCode"]));
    expect(nodes).toHaveLength(0);
  });

  it("collects multiple matching nodes", () => {
    const state = createEditorState("# A\n\n## B\n\n### C", {
      extensions: markdown(),
    });
    const nodes = collectNodes(
      state,
      new Set(["ATXHeading1", "ATXHeading2", "ATXHeading3"]),
    );
    expect(nodes).toHaveLength(3);
    expect(nodes.map((node) => node.type)).toEqual([
      "ATXHeading1",
      "ATXHeading2",
      "ATXHeading3",
    ]);
  });

  it("works with EditorView as well as EditorState", () => {
    view = createTestView("# Title", {
      extensions: markdown(),
    });
    const nodes = collectNodes(view, new Set(["ATXHeading1"]));
    expect(nodes).toHaveLength(1);
  });
});

describe("collectNodeRangesExcludingCursor", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("collects matching nodes and calls buildItem for each", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(1);
    expect(items[0].from).toBe(0);
    expect(items[0].to).toBe(7);
  });

  it("skips nodes where cursor is inside", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 3,
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(0);
  });

  it("ignores non-matching node types", () => {
    const nodeTypes = new Set(["FencedCode"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    const items = collectNodeRangesExcludingCursor(view, nodeTypes, (node, acc) => {
      acc.push(decorationHidden.range(node.from, node.to));
    });

    expect(items).toHaveLength(0);
  });

  it("collects multiple nodes of different types", () => {
    const nodeTypes = new Set(["Emphasis", "StrongEmphasis"]);
    view = createTestView("*em* and **bold** trailing", {
      extensions: markdown(),
      cursorPos: 25,
    });

    const collected: string[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.type.name);
    });

    expect(collected).toContain("Emphasis");
    expect(collected).toContain("StrongEmphasis");
  });

  it("passes SyntaxNodeRef with accessible .node property", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    let hadNodeAccess = false;
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      hadNodeAccess = node.node !== undefined;
    });

    expect(hadNodeAccess).toBe(true);
  });

  it("returns false from buildItem to prevent descending into children", () => {
    const nodeTypes = new Set(["ATXHeading1", "HeaderMark"]);
    view = createTestView("# Hello\n\nworld", {
      extensions: markdown(),
      cursorPos: 14,
    });

    const collected: string[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.type.name);
      return false;
    });

    expect(collected).toEqual(["ATXHeading1"]);
  });

  it("respects custom ranges parameter", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# A\n# B\nend", {
      extensions: markdown(),
      cursorPos: 10,
    });

    const collected: number[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.from);
    }, { ranges: [{ from: 4, to: 8 }] });

    expect(collected).toEqual([4]);
  });

  it("respects skip predicate", () => {
    const nodeTypes = new Set(["ATXHeading1"]);
    view = createTestView("# A\n# B\nend", {
      extensions: markdown(),
      cursorPos: 10,
    });

    const collected: number[] = [];
    collectNodeRangesExcludingCursor(view, nodeTypes, (node) => {
      collected.push(node.from);
    }, { skip: (pos) => pos < 4 });

    expect(collected).toEqual([4]);
  });
});
