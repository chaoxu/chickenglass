import { describe, expect, it } from "vitest";
import {
  parseBibTeX,
  extractLastName,
  type BibEntry,
} from "./bibtex-parser";
import {
  formatCitation,
  formatNarrativeCitation,
} from "./citation-render";

describe("parseBibTeX", () => {
  it("parses a single article entry", () => {
    const bib = `@article{karger2000,
  author = {Karger, David R.},
  title = {Minimum cuts in near-linear time},
  year = {2000},
  journal = {JACM}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("karger2000");
    expect(entries[0].type).toBe("article");
    expect(entries[0].author).toBe("Karger, David R.");
    expect(entries[0].title).toBe("Minimum cuts in near-linear time");
    expect(entries[0].year).toBe("2000");
    expect(entries[0].journal).toBe("JACM");
  });

  it("parses multiple entries", () => {
    const bib = `@article{alpha2020,
  author = {Alpha, A.},
  title = {First paper},
  year = {2020}
}

@book{beta2021,
  author = {Beta, B.},
  title = {A Book Title},
  year = {2021},
  publisher = {Some Publisher}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("alpha2020");
    expect(entries[0].type).toBe("article");
    expect(entries[1].id).toBe("beta2021");
    expect(entries[1].type).toBe("book");
    expect(entries[1].publisher).toBe("Some Publisher");
  });

  it("handles quoted field values", () => {
    const bib = `@article{test2023,
  author = "Doe, John",
  title = "A quoted title",
  year = "2023"
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe("Doe, John");
    expect(entries[0].title).toBe("A quoted title");
  });

  it("handles nested braces in values", () => {
    const bib = `@article{nested2022,
  author = {Smith, John},
  title = {A title with {Proper Nouns} inside},
  year = {2022}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("A title with {Proper Nouns} inside");
  });

  it("handles bare numeric values", () => {
    const bib = `@article{bare2020,
  author = {Test, Author},
  year = 2020,
  volume = 42
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].year).toBe("2020");
    expect(entries[0].volume).toBe("42");
  });

  it("skips @comment and @preamble entries", () => {
    const bib = `@comment{This is a comment}

@preamble{"Some preamble"}

@article{real2020,
  author = {Real, Author},
  year = {2020}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("real2020");
  });

  it("handles inproceedings entry type", () => {
    const bib = `@inproceedings{conf2019,
  author = {Conference, Author},
  title = {A conference paper},
  booktitle = {Proceedings of CONF 2019},
  year = {2019}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("inproceedings");
    expect(entries[0].booktitle).toBe("Proceedings of CONF 2019");
  });

  it("handles case-insensitive entry types", () => {
    const bib = `@Article{upper2020,
  author = {Upper, Case},
  year = {2020}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("article");
  });

  it("handles case-insensitive field names", () => {
    const bib = `@article{mixed2020,
  Author = {Mixed, Case},
  Title = {Mixed Case Title},
  Year = {2020}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe("Mixed, Case");
    expect(entries[0].title).toBe("Mixed Case Title");
  });

  it("returns empty array for empty input", () => {
    expect(parseBibTeX("")).toHaveLength(0);
  });

  it("returns empty array for malformed input", () => {
    expect(parseBibTeX("not a bibtex file")).toHaveLength(0);
  });

  it("handles entries with doi and url fields", () => {
    const bib = `@article{doi2020,
  author = {Doi, Author},
  year = {2020},
  doi = {10.1234/test.2020},
  url = {https://example.com/paper}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].doi).toBe("10.1234/test.2020");
    expect(entries[0].url).toBe("https://example.com/paper");
  });
});

describe("extractLastName", () => {
  it("extracts last name from 'Last, First' format", () => {
    expect(extractLastName("Karger, David R.")).toBe("Karger");
  });

  it("extracts last name from 'First Last' format", () => {
    expect(extractLastName("David Karger")).toBe("Karger");
  });

  it("extracts first author's last name from multiple authors", () => {
    expect(extractLastName("Karger, David and Stein, Clifford")).toBe("Karger");
  });

  it("handles single name", () => {
    expect(extractLastName("Dijkstra")).toBe("Dijkstra");
  });

  it("handles 'First Middle Last' format", () => {
    expect(extractLastName("David Richard Karger")).toBe("Karger");
  });
});

describe("formatCitation", () => {
  it("formats a citation with author and year", () => {
    const entry: BibEntry = {
      id: "karger2000",
      type: "article",
      author: "Karger, David R.",
      year: "2000",
    };
    expect(formatCitation(entry)).toBe("Karger, 2000");
  });

  it("uses id when author is missing", () => {
    const entry: BibEntry = {
      id: "unknown2020",
      type: "article",
      year: "2020",
    };
    expect(formatCitation(entry)).toBe("unknown2020, 2020");
  });

  it("handles missing year", () => {
    const entry: BibEntry = {
      id: "noyear",
      type: "article",
      author: "Smith, John",
    };
    expect(formatCitation(entry)).toBe("Smith, ");
  });
});

describe("formatNarrativeCitation", () => {
  it("formats a narrative citation", () => {
    const entry: BibEntry = {
      id: "karger2000",
      type: "article",
      author: "Karger, David R.",
      year: "2000",
    };
    expect(formatNarrativeCitation(entry)).toBe("Karger (2000)");
  });

  it("uses id when author is missing", () => {
    const entry: BibEntry = {
      id: "unknown2020",
      type: "article",
      year: "2020",
    };
    expect(formatNarrativeCitation(entry)).toBe("unknown2020 (2020)");
  });
});
