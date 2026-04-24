import { describe, expect, it, vi } from "vitest";
import { createTestView } from "../test-utils";
import type { TableRange } from "../state/table-discovery";
import { activateTableStop } from "./vertical-motion-entry-adapters";

function tableRange(from: number, to: number, startLineNumber = 1): TableRange {
  return {
    from,
    to,
    separatorFrom: from + 8,
    separatorTo: from + 16,
    parsed: {
      header: { cells: [{ content: "A" }] },
      alignments: ["none"],
      rows: [{ cells: [{ content: "B" }] }],
    },
    lines: ["| A |", "| - |", "| B |"],
    startLineNumber,
  };
}

function appendTableWidget(
  root: HTMLElement,
  attrs: {
    readonly tableFrom: number;
    readonly sourceFrom?: number;
    readonly sourceTo?: number;
  },
): HTMLElement {
  const container = document.createElement("div");
  container.className = "cf-table-widget";
  container.dataset.tableFrom = String(attrs.tableFrom);
  if (attrs.sourceFrom !== undefined) {
    container.dataset.sourceFrom = String(attrs.sourceFrom);
  }
  if (attrs.sourceTo !== undefined) {
    container.dataset.sourceTo = String(attrs.sourceTo);
  }
  root.append(container);
  return container;
}

describe("activateTableStop", () => {
  it("enters the exact rendered table source range", () => {
    const view = createTestView("| A |\n| - |\n| B |", { focus: false });
    const requestedTable = tableRange(100, 130);
    const staleNearby = appendTableWidget(view.dom, {
      tableFrom: 98,
      sourceFrom: 98,
      sourceTo: 128,
    });
    const exact = appendTableWidget(view.dom, {
      tableFrom: 100,
      sourceFrom: 100,
      sourceTo: 130,
    });
    const staleListener = vi.fn((event: Event) => event.preventDefault());
    const exactListener = vi.fn((event: Event) => event.preventDefault());
    staleNearby.addEventListener("coflat-widget-keyboard-entry", staleListener);
    exact.addEventListener("coflat-widget-keyboard-entry", exactListener);

    try {
      activateTableStop(view, requestedTable, true);

      expect(staleListener).not.toHaveBeenCalled();
      expect(exactListener).toHaveBeenCalledTimes(1);
    } finally {
      view.destroy();
    }
  });

  it("does not hand off to a nearby stale table when the exact widget is absent", () => {
    const view = createTestView("| A |\n| - |\n| B |", { focus: false });
    const requestedTable = tableRange(0, 15);
    const staleNearby = appendTableWidget(view.dom, {
      tableFrom: 1,
      sourceFrom: 1,
      sourceTo: 16,
    });
    const staleListener = vi.fn((event: Event) => event.preventDefault());
    staleNearby.addEventListener("coflat-widget-keyboard-entry", staleListener);

    try {
      activateTableStop(view, requestedTable, true);

      expect(staleListener).not.toHaveBeenCalled();
      expect(view.state.selection.main.head).toBe(requestedTable.from);
    } finally {
      view.destroy();
    }
  });
});
