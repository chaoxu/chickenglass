import { describe, expect, it, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { type BibEntry } from "./bibtex-parser";
import { type BibStore, bibDataEffect, bibDataField } from "./citation-render";
import {
  collectCitedIds,
  formatBibEntry,
  sortBibEntries,
  BibliographyWidget,
  bibliographyPlugin,
} from "./bibliography";
function makeBibStore(entries: BibEntry[]): BibStore {
  return new Map(entries.map((e) => [e.id, e]));
}

const karger: BibEntry = {
  id: "karger2000",
  type: "article",
  author: "Karger, David R.",
  title: "Minimum cuts in near-linear time",
  year: "2000",
  journal: "JACM",
  volume: "47",
  number: "1",
  pages: "46-76",
};

const stein: BibEntry = {
  id: "stein2001",
  type: "book",
  author: "Stein, Clifford",
  title: "Algorithms",
  year: "2001",
  publisher: "MIT Press",
};

const alpha: BibEntry = {
  id: "alpha2019",
  type: "inproceedings",
  author: "Alpha, A.",
  title: "A conference paper",
  year: "2019",
  booktitle: "Proceedings of CONF 2019",
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
    const minimal: BibEntry = { id: "min", type: "misc", year: "2020" };
    expect(formatBibEntry(minimal)).toBe("2020.");
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
    const a: BibEntry = {
      id: "smith2020",
      type: "article",
      author: "Smith, John",
      year: "2020",
    };
    const b: BibEntry = {
      id: "smith2019",
      type: "article",
      author: "Smith, John",
      year: "2019",
    };
    const sorted = sortBibEntries([a, b]);
    expect(sorted.map((e) => e.id)).toEqual(["smith2019", "smith2020"]);
  });

  it("uses id when author is missing", () => {
    const noAuthor: BibEntry = { id: "aaa", type: "misc" };
    const sorted = sortBibEntries([stein, noAuthor]);
    expect(sorted[0].id).toBe("aaa");
  });
});

describe("BibliographyWidget", () => {
  it("creates a div with heading and list", () => {
    const widget = new BibliographyWidget([karger, stein], []);
    const el = widget.toDOM();

    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("cg-bibliography");

    const heading = el.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("References");

    const items = el.querySelectorAll(".cg-bibliography-entry");
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
});

describe("bibliographyPlugin integration", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  function createTestView(doc: string, useStore = true): EditorView {
    const state = EditorState.create({
      doc,
      extensions: [markdown(), bibDataField, bibliographyPlugin],
    });
    const parent = document.createElement("div");
    const v = new EditorView({ state, parent });
    if (useStore) {
      v.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: null }) });
    }
    return v;
  }

  it("creates a view without errors", () => {
    view = createTestView("See [@karger2000].");
    expect(view.state.doc.toString()).toBe("See [@karger2000].");
  });

  it("handles document with no citations", () => {
    view = createTestView("No citations here.");
    expect(view.state.doc.toString()).toBe("No citations here.");
  });

  it("handles empty bib store", () => {
    view = createTestView("See [@karger2000].", false);
    expect(view.state.doc.toString()).toBe("See [@karger2000].");
  });
});
