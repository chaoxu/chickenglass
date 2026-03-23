import { describe, expect, it } from "vitest";
import { parseBibTeX, extractLastName, cleanBibtex } from "./bibtex-parser";

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

  it("converts umlaut accent \\\"u → ü", () => {
    expect(cleanBibtex('\\"u')).toBe("ü");
  });

  it("converts umlaut accent \\\"{u} → ü", () => {
    expect(cleanBibtex('\\"{u}')).toBe("ü");
  });

  it("converts acute accent \\'e → é", () => {
    expect(cleanBibtex("\\'e")).toBe("é");
  });

  it("converts tilde accent \\~n → ñ", () => {
    expect(cleanBibtex("\\~n")).toBe("ñ");
  });

  it("converts circumflex accent \\^o → ô", () => {
    expect(cleanBibtex("\\^o")).toBe("ô");
  });

  it("converts grave accent \\`a → à", () => {
    expect(cleanBibtex("\\`a")).toBe("à");
  });

  it("converts macron accent \\=a → ā", () => {
    expect(cleanBibtex("\\=a")).toBe("ā");
  });

  it("converts dot accent \\.z → ż", () => {
    expect(cleanBibtex("\\.z")).toBe("ż");
  });

  it("converts cedilla \\c{c} → ç", () => {
    expect(cleanBibtex("\\c{c}")).toBe("ç");
  });

  it("converts double acute \\H{o} → ő", () => {
    expect(cleanBibtex("\\H{o}")).toBe("ő");
  });

  it("converts caron \\v{s} → š", () => {
    expect(cleanBibtex("\\v{s}")).toBe("š");
  });

  it("converts breve \\u{a} → ă", () => {
    expect(cleanBibtex("\\u{a}")).toBe("ă");
  });

  it("converts ring \\r{a} → å", () => {
    expect(cleanBibtex("\\r{a}")).toBe("å");
  });

  it("converts dot below \\d{a} → ạ", () => {
    expect(cleanBibtex("\\d{a}")).toBe("ạ");
  });

  it("converts ogonek \\k{a} → ą", () => {
    expect(cleanBibtex("\\k{a}")).toBe("ą");
  });

  it("handles multiple accents in one string", () => {
    expect(cleanBibtex("Caf\\'e na\\\"ive Erd\\H{o}s")).toBe("Café naïve Erdős");
  });

  it("returns empty string for empty input", () => {
    expect(cleanBibtex("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(cleanBibtex("plain text")).toBe("plain text");
  });
});

