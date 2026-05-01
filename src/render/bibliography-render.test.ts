import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";

import {
  BibliographyWidget,
  bibliographyDependenciesChanged,
  buildBibliographyDecorations,
} from "./bibliography-render";
import { type CitationBacklink } from "../citations/citation-matching";
import { type CslJsonItem } from "../citations/csl-json";
import { CslProcessor } from "../citations/csl-processor";
import { CSS } from "../constants/css-classes";
import { markdownExtensions } from "../parser";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { documentAnalysisField } from "../state/document-analysis";
import { applyStateEffects, createEditorState, makeBibStore } from "../test-utils";

const karger: CslJsonItem = {
  id: "karger2000",
  type: "article-journal",
  author: [{ family: "Karger", given: "David R." }],
  title: "Minimum cuts in near-linear time",
  issued: { "date-parts": [[2000]] },
  "container-title": "JACM",
};

const stein: CslJsonItem = {
  id: "stein2001",
  type: "book",
  author: [{ family: "Stein", given: "Clifford" }],
  title: "Algorithms",
  issued: { "date-parts": [[2001]] },
};

function backlinksFor(
  ...entries: ReadonlyArray<readonly [string, readonly CitationBacklink[]]>
): ReadonlyMap<string, readonly CitationBacklink[]> {
  return new Map(entries);
}

function emptyBacklinks(): ReadonlyMap<string, readonly CitationBacklink[]> {
  return new Map();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("BibliographyWidget.createDOM", () => {
  it("renders empty list with the References heading when there are no entries", () => {
    const widget = new BibliographyWidget([], [], emptyBacklinks());
    const dom = widget.createDOM();

    expect(dom.classList.contains(CSS.bibliography)).toBe(true);
    const heading = dom.querySelector(`.${CSS.bibliographyHeading}`);
    expect(heading?.textContent).toBe("References");
    const list = dom.querySelector(`.${CSS.bibliographyList}`);
    expect(list).not.toBeNull();
    expect(list?.children.length).toBe(0);
  });

  it("renders a single plain entry with author, title, and year when no CSL HTML is supplied", () => {
    const widget = new BibliographyWidget([karger], [], emptyBacklinks());
    const dom = widget.createDOM();
    const entries = dom.querySelectorAll(`.${CSS.bibliographyEntry}`);
    expect(entries.length).toBe(1);
    const entry = entries[0] as HTMLElement;
    expect(entry.id).toBe("bib-karger2000");
    expect(entry.textContent).toContain("Karger");
    expect(entry.textContent).toContain("Minimum cuts in near-linear time");
    expect(entry.textContent).toContain("2000");
    // Plain mode prefixes a "[1] " counter.
    expect(entry.textContent?.startsWith("[1]")).toBe(true);
  });

  it("uses CSL HTML for each entry when supplied (preserves IEEE-style numbering)", () => {
    const cslHtml = [
      "<div>[1] D. Karger, &quot;Minimum cuts,&quot; <em>JACM</em>, 2000.</div>",
      "<div>[2] C. Stein, <em>Algorithms</em>. 2001.</div>",
    ];
    const widget = new BibliographyWidget([karger, stein], cslHtml, emptyBacklinks());
    const dom = widget.createDOM();
    const entries = dom.querySelectorAll(`.${CSS.bibliographyEntry}`);
    expect(entries.length).toBe(2);
    expect((entries[0] as HTMLElement).id).toBe("bib-karger2000");
    expect(entries[0].querySelector("em")?.textContent).toBe("JACM");
    expect((entries[1] as HTMLElement).id).toBe("bib-stein2001");
    expect(entries[1].querySelector("em")?.textContent).toBe("Algorithms");
  });

  it("appends backlinks pointing at every in-text citation occurrence", () => {
    const backlinks = backlinksFor(
      ["karger2000", [
        { occurrence: 1, from: 5, to: 18 },
        { occurrence: 2, from: 100, to: 113 },
      ]],
    );
    const widget = new BibliographyWidget([karger], [], backlinks);
    const dom = widget.createDOM();

    const links = dom.querySelectorAll<HTMLAnchorElement>(`.${CSS.bibliographyBacklink}`);
    expect(links.length).toBe(2);
    expect(links[0].dataset.sourceFrom).toBe("5");
    expect(links[0].href).toContain("#cite-ref-1");
    expect(links[1].dataset.sourceFrom).toBe("100");
    expect(links[1].href).toContain("#cite-ref-2");
    expect(links[0].textContent).toBe("↩");
  });

  it("omits the backlink container for entries with no recorded references (orphan)", () => {
    // An entry present in the supplied list but missing from the backlinks map
    // should still render without throwing and without an empty link group.
    const widget = new BibliographyWidget([karger], [], emptyBacklinks());
    const dom = widget.createDOM();
    expect(dom.querySelector(`.${CSS.bibliographyBacklinks}`)).toBeNull();
    const entry = dom.querySelector(`.${CSS.bibliographyEntry}`);
    expect(entry?.id).toBe("bib-karger2000");
  });
});

describe("BibliographyWidget.eq", () => {
  it("returns true for widgets with identical inputs", () => {
    const backlinks = backlinksFor(["karger2000", [{ occurrence: 1, from: 5, to: 18 }]]);
    const a = new BibliographyWidget([karger], [], backlinks);
    const b = new BibliographyWidget([karger], [], backlinks);
    expect(a.eq(b)).toBe(true);
  });

  it("returns false when entry ids differ", () => {
    const a = new BibliographyWidget([karger], [], emptyBacklinks());
    const b = new BibliographyWidget([stein], [], emptyBacklinks());
    expect(a.eq(b)).toBe(false);
  });

  it("returns false when backlink positions differ", () => {
    const a = new BibliographyWidget(
      [karger],
      [],
      backlinksFor(["karger2000", [{ occurrence: 1, from: 5, to: 18 }]]),
    );
    const b = new BibliographyWidget(
      [karger],
      [],
      backlinksFor(["karger2000", [{ occurrence: 1, from: 99, to: 112 }]]),
    );
    expect(a.eq(b)).toBe(false);
  });
});

describe("buildBibliographyDecorations", () => {
  it("places exactly one block widget at the end of the document", () => {
    const state = createEditorState("Hello world", { extensions: [markdown()] });
    const decos = buildBibliographyDecorations(
      state,
      [karger],
      [],
      emptyBacklinks(),
    );
    const cursor = decos.iter();
    expect(cursor.value).not.toBeNull();
    expect(cursor.from).toBe(state.doc.length);
    expect(cursor.to).toBe(state.doc.length);
    cursor.next();
    expect(cursor.value).toBeNull();
  });
});

describe("bibliographyDependenciesChanged", () => {
  function createBibState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: markdownExtensions }),
        documentAnalysisField,
        bibDataField,
      ],
    });
  }

  it("reports false when neither bib data nor analysis change", () => {
    const state = createBibState("Hello.");
    expect(bibliographyDependenciesChanged(state, state)).toBe(false);
  });

  it("reports true after a new bib store is installed", () => {
    const before = createBibState("See [@karger2000].");
    const after = applyStateEffects(
      before,
      bibDataEffect.of({
        store: makeBibStore([karger]),
        cslProcessor: new CslProcessor([karger]),
      }),
    );
    expect(bibliographyDependenciesChanged(before, after)).toBe(true);
  });
});
