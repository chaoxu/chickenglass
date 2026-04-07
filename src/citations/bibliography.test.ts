import { describe, expect, it, afterEach, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { type CslJsonItem } from "./bibtex-parser";
import { bibDataEffect, bibDataField } from "./citation-render";
import { CslProcessor } from "./csl-processor";
import { CSS } from "../constants/css-classes";
import defaultCslStyle from "./ieee.csl?raw";
import {
  createMockEditorView,
  createTestView,
  createEditorState,
  getDecorationSpecs,
  makeBibStore,
} from "../test-utils";
import {
  collectCitedIds,
  formatBibEntry,
  sortBibEntries,
  BibliographyWidget,
  bibliographyDependenciesChanged,
  buildBibliographyDecorations,
  bibliographyPlugin,
} from "./bibliography";
import { documentSemanticsField } from "../semantics/codemirror-source";

const karger: CslJsonItem = {
  id: "karger2000",
  type: "article-journal",
  author: [{ family: "Karger", given: "David R." }],
  title: "Minimum cuts in near-linear time",
  issued: { "date-parts": [[2000]] },
  "container-title": "JACM",
  volume: "47",
  issue: "1",
  page: "46-76",
};

const stein: CslJsonItem = {
  id: "stein2001",
  type: "book",
  author: [{ family: "Stein", given: "Clifford" }],
  title: "Algorithms",
  issued: { "date-parts": [[2001]] },
  publisher: "MIT Press",
};

const alpha: CslJsonItem = {
  id: "alpha2019",
  type: "paper-conference",
  author: [{ family: "Alpha", given: "A." }],
  title: "A conference paper",
  issued: { "date-parts": [[2019]] },
  "container-title": "Proceedings of CONF 2019",
};

const store = makeBibStore([karger, stein, alpha]);
const ieeeCslEntryHtml = [
  '<div class="csl-entry">',
  '<div class="csl-left-margin">[1]</div>',
  '<div class="csl-right-inline">D. R. Karger, <i>JACM</i>, 2000.</div>',
  "</div>",
].join("");

describe("collectCitedIds", () => {
  it("collects ids from parenthetical citations", () => {
    const ids = collectCitedIds("See [@karger2000] and [@stein2001].", store);
    expect(ids).toEqual(["karger2000", "stein2001"]);
  });

  it("collects ids from multiple citations in brackets", () => {
    const ids = collectCitedIds("See [@karger2000; @stein2001].", store);
    expect(ids).toEqual(["karger2000", "stein2001"]);
  });

  it("deduplicates ids", () => {
    const ids = collectCitedIds(
      "See [@karger2000] and again [@karger2000].",
      store,
    );
    expect(ids).toEqual(["karger2000"]);
  });

  it("collects ids from narrative citations", () => {
    const ids = collectCitedIds("As @karger2000 showed.", store);
    expect(ids).toEqual(["karger2000"]);
  });

  it("ignores ids not in the store", () => {
    const ids = collectCitedIds("See [@unknown2020].", store);
    expect(ids).toEqual([]);
  });

  it("returns empty for no citations", () => {
    expect(collectCitedIds("No citations.", store)).toEqual([]);
  });

  describe("negative / edge-case", () => {
    it("returns empty for empty string", () => {
      expect(collectCitedIds("", store)).toEqual([]);
    });

    it("returns empty when store is empty", () => {
      const emptyStore = makeBibStore([]);
      expect(collectCitedIds("See [@karger2000].", emptyStore)).toEqual([]);
    });

    it("handles malformed citation-like text without crashing", () => {
      expect(collectCitedIds("[@]", store)).toEqual([]);
    });
  });
});

describe("formatBibEntry", () => {
  it("formats a journal article", () => {
    const result = formatBibEntry(karger);
    expect(result).toBe(
      "Karger, David R.. Minimum cuts in near-linear time. JACM, 47(1), 46-76. 2000.",
    );
  });

  it("formats a book", () => {
    const result = formatBibEntry(stein);
    expect(result).toBe("Stein, Clifford. Algorithms. 2001.");
  });

  it("formats a conference paper", () => {
    const result = formatBibEntry(alpha);
    expect(result).toBe(
      "Alpha, A.. A conference paper. Proceedings of CONF 2019. 2019.",
    );
  });

  it("handles entry with minimal fields", () => {
    const minimal: CslJsonItem = { id: "min", type: "document", issued: { "date-parts": [[2020]] } };
    expect(formatBibEntry(minimal)).toBe("2020.");
  });

  describe("negative / edge-case", () => {
    it("handles entry with no issued date", () => {
      const noDate: CslJsonItem = {
        id: "nodoc",
        type: "article-journal",
        author: [{ family: "Test", given: "T." }],
        title: "Some title",
      };
      // Should not throw; missing date yields no year fragment
      expect(() => formatBibEntry(noDate)).not.toThrow();
    });

    it("handles entry with no author", () => {
      const noAuthor: CslJsonItem = {
        id: "anon",
        type: "article-journal",
        title: "Anonymous work",
        issued: { "date-parts": [[2021]] },
      };
      expect(() => formatBibEntry(noAuthor)).not.toThrow();
    });

    it("handles entry with literal author", () => {
      const literal: CslJsonItem = {
        id: "org2022",
        type: "report",
        author: [{ literal: "IETF Working Group" }],
        title: "RFC document",
        issued: { "date-parts": [[2022]] },
      };
      expect(() => formatBibEntry(literal)).not.toThrow();
    });
  });
});

describe("sortBibEntries", () => {
  it("sorts by last name alphabetically", () => {
    const sorted = sortBibEntries([stein, karger, alpha]);
    expect(sorted.map((e) => e.id)).toEqual([
      "alpha2019",
      "karger2000",
      "stein2001",
    ]);
  });

  it("sorts by year when names are equal", () => {
    const a: CslJsonItem = {
      id: "smith2020",
      type: "article-journal",
      author: [{ family: "Smith", given: "John" }],
      issued: { "date-parts": [[2020]] },
    };
    const b: CslJsonItem = {
      id: "smith2019",
      type: "article-journal",
      author: [{ family: "Smith", given: "John" }],
      issued: { "date-parts": [[2019]] },
    };
    const sorted = sortBibEntries([a, b]);
    expect(sorted.map((e) => e.id)).toEqual(["smith2019", "smith2020"]);
  });

  it("uses id when author is missing", () => {
    const noAuthor: CslJsonItem = { id: "aaa", type: "document" };
    const sorted = sortBibEntries([stein, noAuthor]);
    expect(sorted[0].id).toBe("aaa");
  });

  describe("negative / edge-case", () => {
    it("returns empty array for empty input", () => {
      expect(sortBibEntries([])).toEqual([]);
    });

    it("returns single-element array unchanged", () => {
      expect(sortBibEntries([karger])).toEqual([karger]);
    });
  });
});

describe("BibliographyWidget", () => {
  it("creates a div with heading and list", () => {
    const widget = new BibliographyWidget([karger, stein], [], new Map());
    const el = widget.toDOM();

    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe(CSS.bibliography);

    const heading = el.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("References");

    const items = el.querySelectorAll(`.${CSS.bibliographyEntry}`);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("bib-karger2000");
    expect(items[1].id).toBe("bib-stein2001");
  });

  it("eq returns true for same entries", () => {
    const a = new BibliographyWidget([karger, stein], [], new Map());
    const b = new BibliographyWidget([karger, stein], [], new Map());
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different entries", () => {
    const a = new BibliographyWidget([karger], [], new Map());
    const b = new BibliographyWidget([stein], [], new Map());
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different lengths", () => {
    const a = new BibliographyWidget([karger], [], new Map());
    const b = new BibliographyWidget([karger, stein], [], new Map());
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when CSL HTML changes with the same entries", () => {
    const a = new BibliographyWidget([karger], ['<span class="csl-entry">[1] Old</span>'], new Map());
    const b = new BibliographyWidget([karger], ['<span class="csl-entry">[1] New</span>'], new Map());
    expect(a.eq(b)).toBe(false);
  });

  it("renders bibliography backlinks for cited entries", () => {
    const widget = new BibliographyWidget(
      [karger],
      [],
      new Map([["karger2000", [{ occurrence: 1, from: 4, to: 17 }]]]),
    );
    const el = widget.toDOM();

    const backlink = el.querySelector(`.${CSS.bibliographyBacklink}`);
    expect(backlink).not.toBeNull();
    expect(backlink?.getAttribute("href")).toBe("#cite-ref-1");
    expect(backlink?.textContent).toBe("↩1");
  });

  it("removes backlink handlers when the widget is destroyed", () => {
    const focus = vi.fn();
    const dispatch = vi.fn();
    const view = createMockEditorView({ focus, dispatch });
    const widget = new BibliographyWidget(
      [karger],
      [],
      new Map([["karger2000", [{ occurrence: 1, from: 4, to: 17 }]]]),
    );

    const el = widget.toDOM(view);
    const backlink = el.querySelector<HTMLElement>(`.${CSS.bibliographyBacklink}`);
    backlink?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 4 },
      scrollIntoView: true,
    });
    expect(focus).toHaveBeenCalledTimes(1);

    dispatch.mockClear();
    focus.mockClear();

    widget.destroy(el);
    backlink?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("preserves citeproc left/right wrappers for numeric bibliography entries", () => {
    const widget = new BibliographyWidget([karger], [ieeeCslEntryHtml], new Map());
    const el = widget.toDOM();
    const entry = el.querySelector(`.${CSS.bibliographyEntry}`);

    expect(entry?.querySelector(".csl-entry")).not.toBeNull();
    expect(entry?.querySelector(".csl-left-margin")?.textContent).toBe("[1]");
    expect(entry?.querySelector(".csl-right-inline")?.textContent).toContain("Karger");
  });
});

describe("buildBibliographyDecorations", () => {
  it("inserts the bibliography as a block widget at document end", () => {
    const specs = getDecorationSpecs(
      buildBibliographyDecorations(createEditorState("hello world"), [karger], [], new Map()),
    );

    expect(specs).toHaveLength(1);
    expect(specs[0].from).toBe(11);
    expect(specs[0].to).toBe(11);
    expect(specs[0].block).toBe(true);
  });
});

describe("bibliographyPlugin integration", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  function createBibView(doc: string, useStore = true): EditorView {
    const v = createTestView(doc, {
      extensions: [markdown(), documentSemanticsField, bibDataField, bibliographyPlugin],
    });
    if (useStore) {
      v.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: new CslProcessor([karger, stein, alpha]) }) });
    }
    return v;
  }

  it("creates a view without errors", () => {
    view = createBibView("See [@karger2000].");
    expect(view.state.doc.toString()).toBe("See [@karger2000].");
  });

  it("handles document with no citations", () => {
    view = createBibView("No citations here.");
    expect(view.state.doc.toString()).toBe("No citations here.");
  });

  it("handles empty bib store", () => {
    view = createBibView("See [@karger2000].", false);
    expect(view.state.doc.toString()).toBe("See [@karger2000].");
  });

  describe("negative / edge-case", () => {
    it("handles empty document with store", () => {
      view = createBibView("");
      expect(view.state.doc.toString()).toBe("");
    });

    it("handles citation to id with no match in store", () => {
      view = createBibView("See [@nonexistent2099].");
      expect(view.state.doc.toString()).toBe("See [@nonexistent2099].");
    });
  });

  describe("invalidation", () => {
    it("ignores unrelated semantic edits after citations", () => {
      const doc = [
        "See [@karger2000].",
        "",
        "# Tail heading",
      ].join("\n");

      view = createBibView(doc);
      const beforeState = view.state;

      view.dispatch({
        changes: {
          from: doc.indexOf("Tail"),
          to: doc.indexOf("Tail") + "Tail".length,
          insert: "Late",
        },
      });

      expect(bibliographyDependenciesChanged(beforeState, view.state)).toBe(false);
    });

    it("tracks cited-id order changes", () => {
      const doc = "See [@karger2000] then [@stein2001].";

      view = createBibView(doc);
      const beforeState = view.state;
      const first = "[@karger2000]";
      const second = "[@stein2001]";
      const firstStart = doc.indexOf(first);
      const secondStart = doc.indexOf(second);

      view.dispatch({
        changes: {
          from: firstStart,
          to: secondStart + second.length,
          insert: `${second} then ${first}`,
        },
      });

      expect(bibliographyDependenciesChanged(beforeState, view.state)).toBe(true);
    });

    it("tracks citation edits that keep the same ids", () => {
      const doc = "See [@karger2000, p. 1].";

      view = createBibView(doc);
      const beforeState = view.state;
      const locator = "p. 1";
      const locatorStart = doc.indexOf(locator);

      view.dispatch({
        changes: {
          from: locatorStart,
          to: locatorStart + locator.length,
          insert: "pp. 10-11",
        },
      });

      expect(bibliographyDependenciesChanged(beforeState, view.state)).toBe(true);
    });

    it("does not reuse cached CSL HTML across different processors", () => {
      const firstProcessor = new CslProcessor([karger, stein, alpha]);
      const secondProcessor = new CslProcessor([karger, stein, alpha]);
      const firstSpy = vi.spyOn(firstProcessor, "bibliography").mockReturnValue([
        '<span class="csl-entry">First processor</span>',
      ]);
      const secondSpy = vi.spyOn(secondProcessor, "bibliography").mockReturnValue([
        '<span class="csl-entry">Second processor</span>',
      ]);

      view = createBibView("See [@karger2000].", false);
      view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: firstProcessor }) });
      expect(firstSpy).toHaveBeenCalledTimes(1);

      view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: secondProcessor }) });

      expect(secondSpy).toHaveBeenCalledTimes(1);
      expect(view.dom.querySelector(`.${CSS.bibliographyEntry}`)?.textContent).toContain("Second processor");
    });

    it("refreshes bibliography when the installed processor changes style", async () => {
      const doc = "See [@karger2000].";
      const processor = await CslProcessor.create([karger, stein, alpha]);

      view = createBibView(doc, false);
      view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: processor }) });
      expect(view.dom.querySelector(`.${CSS.bibliographyEntry} .csl-left-margin`)?.textContent).toBe("[1]");

      await processor.setStyle("<style>invalid</style>");
      view.dispatch({ selection: { anchor: 1 } });

      expect(view.state.field(bibDataField).processorRevision).toBe(processor.revision);
      const fallbackEntry = view.dom.querySelector(`.${CSS.bibliographyEntry}`);
      expect(fallbackEntry?.querySelector(".csl-left-margin")).toBeNull();
      expect(fallbackEntry?.textContent).toContain("[1] Karger, David R..");

      await processor.setStyle(defaultCslStyle);
      view.dispatch({ selection: { anchor: 0 } });

      expect(view.state.field(bibDataField).processorRevision).toBe(processor.revision);
      expect(view.dom.querySelector(`.${CSS.bibliographyEntry} .csl-left-margin`)?.textContent).toBe("[1]");
    });
  });
});
