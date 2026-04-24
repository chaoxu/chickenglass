import { describe, expect, it, vi } from "vitest";
import { type TableRange } from "../state/table-discovery";
import { createTestView } from "../test-utils";
import { createMarkdownLanguageExtensions } from "./base-editor-extensions";
import {
  type HiddenWidgetStop,
  type HiddenWidgetStopKind,
  type WidgetStopIndex,
  firstHiddenWidgetStopBetweenLines,
  getWidgetStopIndex,
  firstTableStopBetweenLines,
  hiddenWidgetStopAtPos,
  tableStopAtPos,
} from "./widget-stop-index";
import { frontmatterField } from "./frontmatter-state";
import { documentAnalysisField } from "../state/document-analysis";
import { tableDiscoveryField } from "../state/table-discovery";

function hiddenStop(
  from: number,
  to: number,
  startLine: number,
  endLine: number,
  kind: HiddenWidgetStopKind = "display-math",
): HiddenWidgetStop {
  return {
    kind,
    from,
    to,
    startLine,
    endLine,
  };
}

function tableRange(
  from: number,
  to: number,
  startLineNumber: number,
): TableRange {
  return {
    from,
    to,
    separatorFrom: from + 10,
    separatorTo: from + 20,
    parsed: {
      header: { cells: [{ content: "A" }] },
      alignments: ["none"],
      rows: [{ cells: [{ content: "B" }] }],
    },
    lines: ["| A |", "| - |", "| B |"],
    startLineNumber,
  };
}

function indexWithStops({
  hiddenStops,
  tableStops,
}: {
  readonly hiddenStops: readonly HiddenWidgetStop[];
  readonly tableStops: readonly {
    readonly table: TableRange;
    readonly startLine: number;
    readonly endLine: number;
  }[];
}): WidgetStopIndex {
  return {
    hiddenStopsForward: hiddenStops,
    hiddenStopsBackward: [...hiddenStops].reverse(),
    hiddenStopsBySpan: [...hiddenStops].sort((left, right) =>
      (left.to - left.from) - (right.to - right.from)
    ),
    tableStopsForward: tableStops,
    tableStopsBackward: [...tableStops].reverse(),
    tableStopsBySpan: [...tableStops].sort((left, right) =>
      (left.table.to - left.table.from) - (right.table.to - right.table.from)
    ),
  };
}

describe("widget stop index queries", () => {
  it("finds the first hidden stop crossed in motion order", () => {
    const first = hiddenStop(20, 30, 4, 5);
    const second = hiddenStop(40, 60, 8, 10);
    const index = indexWithStops({
      hiddenStops: [first, second],
      tableStops: [],
    });

    expect(firstHiddenWidgetStopBetweenLines(index, 2, 12, true)).toBe(first);
    expect(firstHiddenWidgetStopBetweenLines(index, 12, 2, false)).toBe(second);
  });

  it("finds the narrowest hidden stop at a landed position", () => {
    const outer = hiddenStop(10, 40, 3, 8);
    const inner = hiddenStop(18, 22, 4, 4);
    const index = indexWithStops({
      hiddenStops: [outer, inner],
      tableStops: [],
    });

    expect(hiddenWidgetStopAtPos(index, 20)).toBe(inner);
  });

  it("queries table stops with the same ordered index contract", () => {
    const firstTable = tableRange(100, 150, 12);
    const secondTable = tableRange(200, 260, 20);
    const index = indexWithStops({
      hiddenStops: [],
      tableStops: [
        { table: firstTable, startLine: 12, endLine: 14 },
        { table: secondTable, startLine: 20, endLine: 22 },
      ],
    });

    expect(firstTableStopBetweenLines(index, 10, 25, true)).toBe(firstTable);
    expect(firstTableStopBetweenLines(index, 25, 10, false)).toBe(secondTable);
    expect(tableStopAtPos(index, 210)).toBe(secondTable);
  });

  it("builds frontmatter stops from state without rendered DOM widgets", () => {
    const view = createTestView("---\ntitle: Demo\n---\n\nBody", {
      extensions: [frontmatterField],
      focus: false,
    });

    try {
      const stop = getWidgetStopIndex(view).hiddenStopsForward[0];

      expect(stop).toMatchObject({
        kind: "frontmatter",
        from: 0,
        startLine: 1,
        endLine: 3,
      });
    } finally {
      view.destroy();
    }
  });

  it("builds offscreen display-math stops from semantic state", () => {
    const doc = [
      "# Start",
      ...Array.from({ length: 80 }, (_, index) => `line ${index + 1}`),
      "$$",
      "x^2",
      "$$",
      "after",
    ].join("\n");
    const view = createTestView(doc, {
      extensions: [...createMarkdownLanguageExtensions(), documentAnalysisField],
      focus: false,
    });

    try {
      const stop = getWidgetStopIndex(view).hiddenStopsForward.find((candidate) =>
        candidate.kind === "display-math"
      );

      expect(stop).toBeDefined();
      expect(stop?.startLine).toBe(82);
      expect(stop?.endLine).toBe(84);
    } finally {
      view.destroy();
    }
  });

  it("maps canonical stops through document edits by rebuilding from the next EditorState", () => {
    const doc = ["before", "$$", "x", "$$"].join("\n");
    const view = createTestView(doc, {
      extensions: [...createMarkdownLanguageExtensions(), documentAnalysisField],
      focus: false,
    });

    try {
      const before = getWidgetStopIndex(view).hiddenStopsForward.find((candidate) =>
        candidate.kind === "display-math"
      );
      view.dispatch({ changes: { from: 0, insert: "inserted\n" } });
      const after = getWidgetStopIndex(view).hiddenStopsForward.find((candidate) =>
        candidate.kind === "display-math"
      );

      expect(before?.from).toBe("before\n".length);
      expect(after?.from).toBe("inserted\nbefore\n".length);
    } finally {
      view.destroy();
    }
  });

  it("builds block image and table stops from parser/state instead of data-source DOM", () => {
    const doc = [
      "![Alt](image.png)",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const view = createTestView(doc, {
      extensions: [...createMarkdownLanguageExtensions(), tableDiscoveryField],
      focus: false,
    });

    try {
      const index = getWidgetStopIndex(view);
      const imageStop = index.hiddenStopsForward.find((candidate) =>
        candidate.kind === "block-image"
      );

      expect(imageStop).toMatchObject({
        from: 0,
        to: "![Alt](image.png)".length,
        startLine: 1,
        endLine: 1,
      });
      expect(index.tableStopsForward[0]?.startLine).toBe(3);
    } finally {
      view.destroy();
    }
  });

  it("honors local query ranges for vertical motion stop collection", () => {
    const doc = [
      "![Far](far.png)",
      "",
      "plain text",
      "",
      "| Near | Value |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "$$",
      "far = math",
      "$$",
    ].join("\n");
    const view = createTestView(doc, {
      extensions: [
        ...createMarkdownLanguageExtensions(),
        documentAnalysisField,
        tableDiscoveryField,
      ],
      focus: false,
    });

    try {
      const tableLine = view.state.doc.line(5);
      const localIndex = getWidgetStopIndex(view, [
        { from: tableLine.from, to: view.state.doc.line(7).to },
      ]);

      expect(localIndex.hiddenStopsForward).toHaveLength(0);
      expect(localIndex.tableStopsForward).toHaveLength(1);
      expect(localIndex.tableStopsForward[0].table.startLineNumber).toBe(5);
    } finally {
      view.destroy();
    }
  });

  it("does not create a MutationObserver or scan data-source DOM as the primary index", () => {
    const view = createTestView("![Alt](image.png)", {
      extensions: [...createMarkdownLanguageExtensions()],
      focus: false,
    });
    const originalMutationObserver = globalThis.MutationObserver;
    const observer = vi.fn();
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: observer,
    });
    const query = vi.spyOn(view.contentDOM, "querySelectorAll");

    try {
      getWidgetStopIndex(view);

      expect(observer).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalledWith("[data-source-from][data-source-to]");
    } finally {
      view.destroy();
      Object.defineProperty(globalThis, "MutationObserver", {
        configurable: true,
        value: originalMutationObserver,
      });
    }
  });
});
