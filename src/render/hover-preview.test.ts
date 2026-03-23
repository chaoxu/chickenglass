/**
 * Tests for hover-preview per-item targeting in clustered crossref widgets.
 *
 * Regression (#397, reopened twice): CM6's hoverTooltip collapses widget
 * positions to the widget start, so `view.domAtPos(pos)` cannot distinguish
 * sub-items inside a cluster widget. The fix uses `document.elementFromPoint`
 * with tracked mouse coordinates instead.
 *
 * The core DOM-walk logic (`refIdFromElement`) is tested directly here.
 * The `elementFromPoint` integration is verified via browser testing, not
 * JSDOM, since JSDOM does not implement hit-testing.
 */
import { describe, expect, it } from "vitest";
import { refIdFromElement } from "./hover-preview";

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
    // The container itself has no data-ref-id
    expect(refIdFromElement(container)).toBeNull();
  });

  it("walks up from nested child to find data-ref-id on ancestor", () => {
    // Simulate elementFromPoint landing on a deeply nested element
    // inside a data-ref-id span (e.g. a <em> or <strong> inside the label)
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

    // Should find "close" first, not "far"
    expect(refIdFromElement(child)).toBe("close");
  });
});

describe("per-item targeting invariants (#397 regression)", () => {
  it("different items in a cluster resolve to different ref ids", () => {
    // Regression: the old view.domAtPos(pos) approach returned the same
    // element for all items because CM6 collapses widget positions.
    // With elementFromPoint + refIdFromElement, each item span is distinct.
    const { spans } = createClusterDOM([
      { id: "eq:alpha", label: "Eq. (1)" },
      { id: "eq:beta", label: "Eq. (2)" },
    ]);

    const resultA = refIdFromElement(spans[0]);
    const resultB = refIdFromElement(spans[1]);

    expect(resultA).toBe("eq:alpha");
    expect(resultB).toBe("eq:beta");
    // Key invariant: they MUST be different
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
    // When elementFromPoint lands on a text node, the browser returns
    // the parent element. For separator text nodes, the parent is the
    // container which has no data-ref-id.
    const { container } = createClusterDOM([
      { id: "thm-a", label: "Theorem 1" },
      { id: "thm-b", label: "Theorem 2" },
    ]);

    // The container element (parent of separator text nodes) has no
    // data-ref-id attribute, so refIdFromElement should return null.
    expect(refIdFromElement(container)).toBeNull();
  });

  it("MixedClusterWidget structure: parens wrapper has no data-ref-id", () => {
    // MixedClusterWidget wraps content in parens. The outer container
    // should not have data-ref-id.
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

    // Items should resolve correctly
    expect(refIdFromElement(span1)).toBe("eq:a");
    expect(refIdFromElement(span2)).toBe("smith");
    // Container should not resolve
    expect(refIdFromElement(container)).toBeNull();
  });
});
