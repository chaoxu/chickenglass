import { describe, expect, it, vi } from "vitest";
import { type TableRange } from "../state/table-discovery";
import { createTestView } from "../test-utils";
import {
  disposeWidgetStopIndex,
  type HiddenWidgetStop,
  type WidgetStopIndex,
  firstHiddenWidgetStopBetweenLines,
  getWidgetStopIndex,
  firstTableStopBetweenLines,
  hiddenWidgetStopAtPos,
  tableStopAtPos,
  widgetStopIndexCleanupExtension,
} from "./widget-stop-index";

function hiddenStop(
  from: number,
  to: number,
  startLine: number,
  endLine: number,
): HiddenWidgetStop {
  return {
    from,
    to,
    startLine,
    endLine,
    element: document.createElement("div"),
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

  it("disconnects the DOM observer when the editor view is destroyed", () => {
    const originalMutationObserver = globalThis.MutationObserver;
    const globalWithMutationObserver = globalThis as typeof globalThis & {
      MutationObserver?: typeof MutationObserver;
    };
    const instances: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    const FakeMutationObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = () => [];

      constructor() {
        instances.push(this);
      }
    } as unknown as typeof MutationObserver;
    globalWithMutationObserver.MutationObserver = FakeMutationObserver;

    const view = createTestView("hello", {
      extensions: widgetStopIndexCleanupExtension,
      focus: false,
    });

    try {
      const observerCountBeforeIndex = instances.length;
      getWidgetStopIndex(view);

      const [widgetObserver] = instances.slice(observerCountBeforeIndex);
      expect(widgetObserver).toBeDefined();
      expect(widgetObserver?.observe).toHaveBeenCalledWith(view.contentDOM, {
        childList: true,
        subtree: true,
      });

      view.destroy();

      expect(widgetObserver?.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      disposeWidgetStopIndex(view);
      if (originalMutationObserver) {
        globalWithMutationObserver.MutationObserver = originalMutationObserver;
      } else {
        Reflect.deleteProperty(globalWithMutationObserver, "MutationObserver");
      }
    }
  });
});
