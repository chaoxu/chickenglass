import { describe, expect, it, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { type CslJsonItem } from "./bibtex-parser";
import { bibDataEffect, bibDataField } from "./citation-render";
import { CslProcessor } from "./csl-processor";
import { CSS } from "../constants/css-classes";
import {
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
    const widget = new BibliographyWidget([karger, stein], []);
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
    const a = new BibliographyWidget([karger, stein], []);
    const b = new BibliographyWidget([karger, stein], []);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different entries", () => {
    const a = new BibliographyWidget([karger], []);
    const b = new BibliographyWidget([stein], []);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different lengths", () => {
    const a = new BibliographyWidget([karger], []);
    const b = new BibliographyWidget([karger, stein], []);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when CSL HTML changes with the same entries", () => {
    const a = new BibliographyWidget([karger], ['<span class="csl-entry">[1] Old</span>']);
    const b = new BibliographyWidget([karger], ['<span class="csl-entry">[1] New</span>']);
    expect(a.eq(b)).toBe(false);
  });
});

describe("buildBibliographyDecorations", () => {
  it("inserts the bibliography as a block widget at document end", () => {
    const specs = getDecorationSpecs(
      buildBibliographyDecorations(createEditorState("hello world"), [karger], []),
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
});
