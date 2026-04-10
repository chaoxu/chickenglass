import { describe, expect, it } from "vitest";
import { CitationWidget } from "../citations/citation-render";
import {
  ClusteredCrossrefWidget,
  CrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
import {
  findReferenceWidgetContainer,
  isReferenceWidgetTarget,
  REFERENCE_WIDGET_SELECTOR,
} from "./reference-widget";

describe("ReferenceWidget shared DOM contract", () => {
  it("marks single-node reference widgets as shared reference roots", () => {
    const widgets = [
      new CitationWidget("(Karger, 2000)", ["karger2000"]).toDOM(),
      new CrossrefWidget(
        { kind: "block", label: "Theorem 1", number: 1 },
        "[@thm:main]",
      ).toDOM(),
      new UnresolvedRefWidget("[@missing]").toDOM(),
    ];

    for (const el of widgets) {
      expect(el.matches(REFERENCE_WIDGET_SELECTOR)).toBe(true);
      expect(el.dataset.referenceWidget).toBe("true");
      expect(isReferenceWidgetTarget(el)).toBe(true);
    }
  });

  it("finds the shared container from a nested cluster item descendant", () => {
    const widgetEl = new ClusteredCrossrefWidget(
      [
        { id: "thm:a", text: "Theorem 1" },
        { id: "thm:b", text: "Theorem 2" },
      ],
      "[@thm:a; @thm:b]",
    ).toDOM();
    const firstItem = widgetEl.querySelector<HTMLElement>("span[data-ref-id]");
    expect(firstItem).not.toBeNull();
    if (!firstItem) {
      throw new Error("expected clustered crossref item");
    }

    const nested = document.createElement("strong");
    nested.textContent = firstItem.textContent ?? "";
    firstItem.replaceChildren(nested);

    expect(findReferenceWidgetContainer(nested)).toBe(widgetEl);
    expect(isReferenceWidgetTarget(nested)).toBe(true);
  });

  it("marks mixed clusters for shared selector consumers", () => {
    const widgetEl = new MixedClusterWidget(
      [
        { kind: "crossref", id: "eq:alpha", text: "Eq. (1)" },
        { kind: "citation", id: "karger2000", text: "Karger, 2000" },
      ],
      "[@eq:alpha; @karger2000]",
    ).toDOM();

    expect(widgetEl.matches(REFERENCE_WIDGET_SELECTOR)).toBe(true);
    expect(isReferenceWidgetTarget(widgetEl)).toBe(true);
  });
});
