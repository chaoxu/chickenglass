import { describe, expect, it, beforeEach } from "vitest";
import {
  parseBibTeX,
  extractFirstFamilyName,
  extractYear,
  formatCslAuthors,
  cleanBibtex,
  clearBibParseCache,
} from "./bibtex-parser";

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
    expect(entries[0].type).toBe("article-journal");
    expect(entries[0].author).toEqual([{ family: "Karger", given: "David R." }]);
    expect(entries[0].title).toBe("Minimum cuts in near-linear time");
    expect(extractYear(entries[0])).toBe("2000");
    expect(entries[0]["container-title"]).toBe("JACM");
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
    expect(entries[0].type).toBe("article-journal");
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
    expect(entries[0].author).toEqual([{ family: "Doe", given: "John" }]);
    expect(entries[0].title).toBe("A quoted title");
  });

  it("strips nested braces from values", () => {
    const bib = `@article{nested2022,
  author = {Smith, John},
  title = {A title with {Proper Nouns} inside},
  year = {2022}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("A title with Proper Nouns inside");
  });

  it("converts LaTeX accents to Unicode", () => {
    const bib = `@article{accent2022,
  author = {M\\"uller, Hans},
  title = {Caf\\'e and na\\"{\\i}ve},
  year = {2022}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toContain("Café");
  });

  it("handles bare numeric values", () => {
    const bib = `@article{bare2020,
  author = {Test, Author},
  year = 2020,
  volume = 42
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(extractYear(entries[0])).toBe("2020");
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
    expect(entries[0].type).toBe("paper-conference");
    expect(entries[0]["container-title"]).toBe("Proceedings of CONF 2019");
  });

  it("handles case-insensitive entry types", () => {
    const bib = `@Article{upper2020,
  author = {Upper, Case},
  year = {2020}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("article-journal");
  });

  it("handles case-insensitive field names", () => {
    const bib = `@article{mixed2020,
  Author = {Mixed, Case},
  Title = {Mixed Case Title},
  Year = {2020}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toEqual([{ family: "Mixed", given: "Case" }]);
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
    expect(entries[0].DOI).toBe("10.1234/test.2020");
    expect(entries[0].URL).toBe("https://example.com/paper");
  });

  it("retries after stripping malformed abstract fields", () => {
    const bib = `@article{Frederickson93,
  title = {A Note on the Complexity of a Simple Transportation Problem},
  author = {Frederickson, Greg N.},
  year = {1993},
  journal = {SIAM Journal on Computing},
  abstract = {Consider the problem of using a vehicle to transport k objects one at a time between stations on a circular track, where q {$<\\_$} min\\{k, \\}.},
  doi = {10.1137/0222005}
}`;
    const entries = parseBibTeX(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("Frederickson93");
    expect(entries[0].title).toBe("A Note on the Complexity of a Simple Transportation Problem");
    expect(entries[0].DOI).toBe("10.1137/0222005");
  });

  describe("caching", () => {
    beforeEach(() => {
      clearBibParseCache();
    });

    it("returns same reference for identical content", () => {
      const bib = `@article{a2020, author = {A, B}, year = {2020}}`;
      const first = parseBibTeX(bib);
      const second = parseBibTeX(bib);
      expect(second).toBe(first);
    });

    it("returns different results for different content", () => {
      const bib1 = `@article{a2020, author = {A, B}, year = {2020}}`;
      const bib2 = `@article{b2021, author = {C, D}, year = {2021}}`;
      const first = parseBibTeX(bib1);
      const second = parseBibTeX(bib2);
      expect(second).not.toBe(first);
      expect(second[0].id).toBe("b2021");
    });
  });
});

describe("extractFirstFamilyName", () => {
  it("extracts family name from CSL author array", () => {
    expect(
      extractFirstFamilyName([{ family: "Karger", given: "David R." }], "fallback"),
    ).toBe("Karger");
  });

  it("handles literal author name", () => {
    expect(
      extractFirstFamilyName([{ literal: "ACME Corp" }], "fallback"),
    ).toBe("ACME Corp");
  });

  it("extracts first author from multiple authors", () => {
    expect(
      extractFirstFamilyName(
        [{ family: "Karger", given: "David" }, { family: "Stein", given: "Clifford" }],
        "fallback",
      ),
    ).toBe("Karger");
  });

  it("returns fallback when no authors", () => {
    expect(extractFirstFamilyName(undefined, "myid")).toBe("myid");
    expect(extractFirstFamilyName([], "myid")).toBe("myid");
  });
});

describe("extractYear", () => {
  it("extracts year from issued field", () => {
    expect(extractYear({ id: "x", type: "article-journal", issued: { "date-parts": [[2000]] } })).toBe("2000");
  });

  it("returns undefined when no issued field", () => {
    expect(extractYear({ id: "x", type: "article-journal" })).toBeUndefined();
  });
});

describe("formatCslAuthors", () => {
  it("formats single author", () => {
    expect(formatCslAuthors([{ family: "Karger", given: "David R." }])).toBe("Karger, David R.");
  });

  it("formats multiple authors with 'and'", () => {
    expect(
      formatCslAuthors([
        { family: "Karger", given: "David" },
        { family: "Stein", given: "Clifford" },
      ]),
    ).toBe("Karger, David and Stein, Clifford");
  });

  it("formats literal author name", () => {
    expect(formatCslAuthors([{ literal: "ACME Corp" }])).toBe("ACME Corp");
  });

  it("returns empty string for no authors", () => {
    expect(formatCslAuthors(undefined)).toBe("");
    expect(formatCslAuthors([])).toBe("");
  });
});

describe("cleanBibtex", () => {
  it("strips protective braces", () => {
    expect(cleanBibtex("{Title Text}")).toBe("Title Text");
  });

  it("strips nested braces", () => {
    expect(cleanBibtex("A {title} with {Proper Nouns}")).toBe(
      "A title with Proper Nouns",
    );
  });

  it("preserves escaped braces", () => {
    expect(cleanBibtex("Set \\{1, 2, 3\\}")).toBe("Set {1, 2, 3}");
  });

  it("converts umlaut accent \\\"u -> u with umlaut", () => {
    expect(cleanBibtex('\\"u')).toBe("\u00fc");
  });

  it("converts umlaut accent \\\"{u} -> u with umlaut", () => {
    expect(cleanBibtex('\\"{u}')).toBe("\u00fc");
  });

  it("converts acute accent \\'e -> e with acute", () => {
    expect(cleanBibtex("\\'e")).toBe("\u00e9");
  });

  it("converts tilde accent \\~n -> n with tilde", () => {
    expect(cleanBibtex("\\~n")).toBe("\u00f1");
  });

  it("converts circumflex accent \\^o -> o with circumflex", () => {
    expect(cleanBibtex("\\^o")).toBe("\u00f4");
  });

  it("converts grave accent \\`a -> a with grave", () => {
    expect(cleanBibtex("\\`a")).toBe("\u00e0");
  });

  it("converts macron accent \\=a -> a with macron", () => {
    expect(cleanBibtex("\\=a")).toBe("\u0101");
  });

  it("converts dot accent \\.z -> z with dot above", () => {
    expect(cleanBibtex("\\.z")).toBe("\u017c");
  });

  it("converts cedilla \\c{c} -> c with cedilla", () => {
    expect(cleanBibtex("\\c{c}")).toBe("\u00e7");
  });

  it("converts double acute \\H{o} -> o with double acute", () => {
    expect(cleanBibtex("\\H{o}")).toBe("\u0151");
  });

  it("converts caron \\v{s} -> s with caron", () => {
    expect(cleanBibtex("\\v{s}")).toBe("\u0161");
  });

  it("converts breve \\u{a} -> a with breve", () => {
    expect(cleanBibtex("\\u{a}")).toBe("\u0103");
  });

  it("converts ring \\r{a} -> a with ring above", () => {
    expect(cleanBibtex("\\r{a}")).toBe("\u00e5");
  });

  it("converts dot below \\d{a} -> a with dot below", () => {
    expect(cleanBibtex("\\d{a}")).toBe("\u1ea1");
  });

  it("converts ogonek \\k{a} -> a with ogonek", () => {
    expect(cleanBibtex("\\k{a}")).toBe("\u0105");
  });

  it("handles multiple accents in one string", () => {
    expect(cleanBibtex("Caf\\'e na\\\"ive Erd\\H{o}s")).toBe("Caf\u00e9 na\u00efve Erd\u0151s");
  });

  it("returns empty string for empty input", () => {
    expect(cleanBibtex("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(cleanBibtex("plain text")).toBe("plain text");
  });
});
