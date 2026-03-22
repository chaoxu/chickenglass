import { describe, expect, it, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { type BibEntry } from "./bibtex-parser";
import { createTestView as createSharedTestView, makeBibStore } from "../test-utils";
import {
  findCitations,
  formatParenthetical,
  CitationWidget,
  NarrativeCitationWidget,
  bibDataEffect,
  bibDataField,
} from "./citation-render";
import { referenceRenderPlugin } from "../render/reference-render";
import { equationLabelsField } from "../index/crossref-resolver";

const karger: BibEntry = {
  id: "karger2000",
  type: "article",
  author: "Karger, David R.",
  title: "Minimum cuts in near-linear time",
  year: "2000",
  journal: "JACM",
};

const stein: BibEntry = {
  id: "stein2001",
  type: "book",
  author: "Stein, Clifford",
  title: "Algorithms",
  year: "2001",
};

const store = makeBibStore([karger, stein]);

describe("findCitations", () => {
  it("finds a single parenthetical citation", () => {
    const matches = findCitations("See [@karger2000] for details.", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(4);
    expect(matches[0].to).toBe(17);
    expect(matches[0].parenthetical).toBe(true);
    expect(matches[0].ids).toEqual(["karger2000"]);
  });

  it("finds multiple citations in brackets", () => {
    const matches = findCitations("See [@karger2000; @stein2001].", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000", "stein2001"]);
    expect(matches[0].parenthetical).toBe(true);
  });

  it("finds narrative citations", () => {
    const matches = findCitations("As shown by @karger2000, the result holds.", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].parenthetical).toBe(false);
    expect(matches[0].ids).toEqual(["karger2000"]);
  });

  it("ignores citations not in the store", () => {
    const matches = findCitations("See [@unknown2020] for details.", store);
    expect(matches).toHaveLength(0);
  });

  it("treats as citation only if at least one id is in store", () => {
    const matches = findCitations("See [@karger2000; @unknown2020].", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000", "unknown2020"]);
  });

  it("does not match @id inside brackets as narrative", () => {
    // Inside brackets should be caught by parenthetical pattern only
    const matches = findCitations("[@karger2000]", store);
    // Should find exactly one parenthetical match, not a narrative one
    const narrative = matches.filter((m) => !m.parenthetical);
    expect(narrative).toHaveLength(0);
  });

  it("handles multiple separate citations", () => {
    const text = "See [@karger2000] and [@stein2001].";
    const matches = findCitations(text, store);
    expect(matches).toHaveLength(2);
    expect(matches[0].ids).toEqual(["karger2000"]);
    expect(matches[1].ids).toEqual(["stein2001"]);
  });

  it("returns empty for text with no citations", () => {
    expect(findCitations("No citations here.", store)).toHaveLength(0);
  });

  it("parses a citation with a locator", () => {
    const matches = findCitations("See [@karger2000, chap. 36].", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000"]);
    expect(matches[0].locators).toEqual(["chap. 36"]);
  });

  it("parses a citation with page locator", () => {
    const matches = findCitations("[@karger2000, pp. 100-120]", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000"]);
    expect(matches[0].locators).toEqual(["pp. 100-120"]);
  });

  it("parses multiple citations each with locators", () => {
    const matches = findCitations("[@karger2000, theorem 3; @stein2001, p. 42]", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000", "stein2001"]);
    expect(matches[0].locators).toEqual(["theorem 3", "p. 42"]);
  });

  it("handles mixed citations with and without locators", () => {
    const matches = findCitations("[@karger2000; @stein2001, chap. 5]", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].ids).toEqual(["karger2000", "stein2001"]);
    expect(matches[0].locators).toEqual([undefined, "chap. 5"]);
  });

  it("returns undefined locators when none present", () => {
    const matches = findCitations("[@karger2000]", store);
    expect(matches).toHaveLength(1);
    expect(matches[0].locators).toEqual([undefined]);
  });
});

describe("formatParenthetical", () => {
  it("formats a single citation", () => {
    expect(formatParenthetical(["karger2000"], store)).toBe("(Karger, 2000)");
  });

  it("formats multiple citations separated by semicolons", () => {
    expect(formatParenthetical(["karger2000", "stein2001"], store)).toBe(
      "(Karger, 2000; Stein, 2001)",
    );
  });

  it("falls back to id for unknown entries", () => {
    expect(formatParenthetical(["unknown2020"], store)).toBe("(unknown2020)");
  });

  it("formats a citation with a locator", () => {
    expect(
      formatParenthetical(["karger2000"], store, ["chap. 36"]),
    ).toBe("(Karger, 2000, chap. 36)");
  });

  it("formats multiple citations with mixed locators", () => {
    expect(
      formatParenthetical(["karger2000", "stein2001"], store, [undefined, "pp. 1-10"]),
    ).toBe("(Karger, 2000; Stein, 2001, pp. 1-10)");
  });
});

describe("CitationWidget", () => {
  it("creates a span with citation text", () => {
    const widget = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("cf-citation");
    expect(el.textContent).toBe("(Karger, 2000)");
    expect(el.title).toBe("karger2000");
  });

  it("shows multiple ids in title", () => {
    const widget = new CitationWidget("(Karger, 2000; Stein, 2001)", [
      "karger2000",
      "stein2001",
    ]);
    const el = widget.toDOM();
    expect(el.title).toBe("karger2000; stein2001");
  });

  it("eq returns true for same text", () => {
    const a = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const b = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different text", () => {
    const a = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const b = new CitationWidget("(Stein, 2001)", ["stein2001"]);
    expect(a.eq(b)).toBe(false);
  });
});

describe("NarrativeCitationWidget", () => {
  it("creates a span with narrative citation text", () => {
    const widget = new NarrativeCitationWidget("Karger (2000)", "karger2000");
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("cf-citation");
    expect(el.className).toContain("cf-citation-narrative");
    expect(el.textContent).toBe("Karger (2000)");
  });

  it("eq returns true for same text", () => {
    const a = new NarrativeCitationWidget("Karger (2000)", "karger2000");
    const b = new NarrativeCitationWidget("Karger (2000)", "karger2000");
    expect(a.eq(b)).toBe(true);
  });
});

describe("referenceRenderPlugin citation integration", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  function createTestView(doc: string, cursorPos?: number): EditorView {
    const view = createSharedTestView(doc, {
      cursorPos,
      extensions: [markdown(), bibDataField, equationLabelsField, referenceRenderPlugin],
    });
    view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: null }) });
    return view;
  }

  it("creates a view with the plugin without errors", () => {
    view = createTestView("See [@karger2000] for details.");
    expect(view.state.doc.toString()).toBe("See [@karger2000] for details.");
  });

  it("handles document with no citations", () => {
    view = createTestView("No citations here.");
    expect(view.state.doc.toString()).toBe("No citations here.");
  });

  it("handles empty document", () => {
    view = createTestView("");
    expect(view.state.doc.toString()).toBe("");
  });

  it("handles multiple citations in one document", () => {
    const doc = "See [@karger2000] and [@stein2001].";
    view = createTestView(doc);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("handles cursor at citation position", () => {
    view = createTestView("See [@karger2000] for details.", 5);
    expect(view.state.doc.toString()).toContain("[@karger2000]");
  });
});
