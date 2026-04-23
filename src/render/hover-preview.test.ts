/**
 * Tests for hover-preview per-item targeting in clustered crossref widgets.
 *
 * Regression (#397, reopened 3x): CM6's hoverTooltip collapses widget
 * positions to the widget start, so sliding the mouse from item 1 to item 2
 * within the same widget kept showing item 1's tooltip. The fix replaces
 * CM6's hoverTooltip entirely with @floating-ui/dom + DOM mouseenter/mouseleave
 * event delegation, where each `<span data-ref-id>` fires its own events.
 *
 * The core DOM-walk logic (`refIdFromElement`) is tested directly here.
 * The full integration (tooltip positioning, hover delay) is verified via
 * browser testing since JSDOM does not implement hit-testing or layout.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  destroyHoverPreviewTooltipForTest,
  ensureHoverPreviewTooltipForTest,
  getCachedTooltipContentForTest,
  hoverPreviewExtension,
  refIdFromElement,
  shouldRebuildHoverPreviewContentForTest,
} from "./hover-preview";

/**
 * Helper: create a cluster DOM structure mimicking ClusteredCrossrefWidget
 * or MixedClusterWidget, with per-item `<span data-ref-id>` children
 * separated by text node separators.
 */
function createClusterDOM(
  items: Array<{ id: string; label: string }>,
): { container: HTMLElement; spans: HTMLSpanElement[] } {
  const container = document.createElement("span");
  container.className = "cf-crossref";

  const spans: HTMLSpanElement[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      container.appendChild(document.createTextNode("; "));
    }
    const span = document.createElement("span");
    span.setAttribute("data-ref-id", items[i].id);
    span.textContent = items[i].label;
    container.appendChild(span);
    spans.push(span);
  }

  return { container, spans };
}

function createHoverPreviewView(): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: [hoverPreviewExtension],
    }),
    parent,
  });
}

afterEach(() => {
  destroyHoverPreviewTooltipForTest();
  document.body.innerHTML = "";
});

describe("refIdFromElement", () => {
  it("returns data-ref-id from a direct hit on an item span", () => {
    const { spans } = createClusterDOM([
      { id: "thm-a", label: "Theorem 1" },
      { id: "thm-b", label: "Theorem 2" },
    ]);

    expect(refIdFromElement(spans[0])).toBe("thm-a");
    expect(refIdFromElement(spans[1])).toBe("thm-b");
  });

  it("returns null for null input", () => {
    expect(refIdFromElement(null)).toBeNull();
  });

  it("returns null for an element without data-ref-id", () => {
    const div = document.createElement("div");
    div.textContent = "plain text";
    expect(refIdFromElement(div)).toBeNull();
  });

  it("returns null for the container (no data-ref-id on container)", () => {
    const { container } = createClusterDOM([
      { id: "thm-a", label: "Theorem 1" },
    ]);
    expect(refIdFromElement(container)).toBeNull();
  });

  it("walks up from nested child to find data-ref-id on ancestor", () => {
    const outer = document.createElement("span");
    outer.setAttribute("data-ref-id", "thm-deep");
    const inner = document.createElement("em");
    inner.textContent = "nested content";
    outer.appendChild(inner);

    expect(refIdFromElement(inner)).toBe("thm-deep");
  });

  it("walks up multiple levels to find data-ref-id", () => {
    const outer = document.createElement("span");
    outer.setAttribute("data-ref-id", "eq:nested");
    const mid = document.createElement("span");
    const inner = document.createElement("strong");
    inner.textContent = "deeply nested";
    mid.appendChild(inner);
    outer.appendChild(mid);

    expect(refIdFromElement(inner)).toBe("eq:nested");
  });

  it("returns the closest ancestor's data-ref-id (not a farther one)", () => {
    const grandparent = document.createElement("span");
    grandparent.setAttribute("data-ref-id", "far");
    const parent = document.createElement("span");
    parent.setAttribute("data-ref-id", "close");
    const child = document.createElement("span");
    child.textContent = "text";
    parent.appendChild(child);
    grandparent.appendChild(parent);

    expect(refIdFromElement(child)).toBe("close");
  });
});

describe("per-item targeting invariants (#397 regression)", () => {
  it("different items in a cluster resolve to different ref ids", () => {
    const { spans } = createClusterDOM([
      { id: "eq:alpha", label: "Eq. (1)" },
      { id: "eq:beta", label: "Eq. (2)" },
    ]);

    const resultA = refIdFromElement(spans[0]);
    const resultB = refIdFromElement(spans[1]);

    expect(resultA).toBe("eq:alpha");
    expect(resultB).toBe("eq:beta");
    expect(resultA).not.toBe(resultB);
  });

  it("three-item cluster returns correct id for each item", () => {
    const { spans } = createClusterDOM([
      { id: "thm-1", label: "Theorem 1" },
      { id: "thm-2", label: "Theorem 2" },
      { id: "thm-3", label: "Theorem 3" },
    ]);

    for (let i = 0; i < spans.length; i++) {
      expect(refIdFromElement(spans[i])).toBe(`thm-${i + 1}`);
    }
  });

  it("separator text node (converted to parent) yields null", () => {
    const { container } = createClusterDOM([
      { id: "thm-a", label: "Theorem 1" },
      { id: "thm-b", label: "Theorem 2" },
    ]);

    expect(refIdFromElement(container)).toBeNull();
  });

  it("MixedClusterWidget structure: parens wrapper has no data-ref-id", () => {
    const container = document.createElement("span");
    container.className = "cf-citation";
    container.appendChild(document.createTextNode("("));

    const span1 = document.createElement("span");
    span1.setAttribute("data-ref-id", "eq:a");
    span1.textContent = "Eq. (1)";
    container.appendChild(span1);

    container.appendChild(document.createTextNode("; "));

    const span2 = document.createElement("span");
    span2.setAttribute("data-ref-id", "smith");
    span2.textContent = "Smith, 2020";
    container.appendChild(span2);

    container.appendChild(document.createTextNode(")"));

    expect(refIdFromElement(span1)).toBe("eq:a");
    expect(refIdFromElement(span2)).toBe("smith");
    expect(refIdFromElement(container)).toBeNull();
  });
});

describe("tooltip lifecycle", () => {
  it("removes the singleton tooltip element from document.body on destroy", () => {
    const view = createHoverPreviewView();
    const tooltip = ensureHoverPreviewTooltipForTest();

    expect(document.body.contains(tooltip)).toBe(true);

    view.destroy();

    expect(document.body.contains(tooltip)).toBe(false);

    const recreatedTooltip = ensureHoverPreviewTooltipForTest();
    expect(recreatedTooltip).not.toBe(tooltip);
  });
});

describe("tooltip content cache", () => {
  it("reuses the same DOM subtree for the same state scope and plan key", () => {
    const cacheScope = {};
    const buildContent = vi.fn(() => {
      const content = document.createElement("div");
      content.textContent = "Theorem 1";
      return content;
    });

    const first = getCachedTooltipContentForTest(
      cacheScope,
      "crossref:block\0thm:main",
      buildContent,
    );
    const second = getCachedTooltipContentForTest(
      cacheScope,
      "crossref:block\0thm:main",
      buildContent,
    );

    expect(second).toBe(first);
    expect(buildContent).toHaveBeenCalledTimes(1);
  });

  it("rebuilds content when the editor state scope changes", () => {
    const buildContent = vi.fn(() => document.createElement("div"));

    const first = getCachedTooltipContentForTest(
      {},
      "crossref:block\0thm:main",
      buildContent,
    );
    const second = getCachedTooltipContentForTest(
      {},
      "crossref:block\0thm:main",
      buildContent,
    );

    expect(second).not.toBe(first);
    expect(buildContent).toHaveBeenCalledTimes(2);
  });

  it("rebuilds content for a different plan key within the same state scope", () => {
    const cacheScope = {};
    const buildContent = vi.fn(() => document.createElement("div"));

    const first = getCachedTooltipContentForTest(
      cacheScope,
      "crossref:block\0thm:one",
      buildContent,
    );
    const second = getCachedTooltipContentForTest(
      cacheScope,
      "crossref:block\0thm:two",
      buildContent,
    );

    expect(second).not.toBe(first);
    expect(buildContent).toHaveBeenCalledTimes(2);
  });

  it("forces a rebuild for media cache changes even when the plan key is stable", () => {
    expect(shouldRebuildHoverPreviewContentForTest("media:key", "media:key", true)).toBe(true);
    expect(shouldRebuildHoverPreviewContentForTest("media:key", "media:key", false)).toBe(false);
    expect(shouldRebuildHoverPreviewContentForTest("media:key", "media:new", false)).toBe(true);
  });
});
