import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it, vi } from "vitest";
import { frontmatterField } from "../editor/frontmatter-state";
import { equationLabelExtension } from "../parser/equation-label";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { createPluginRegistryField } from "../state/plugin-registry";
import { blockCounterField } from "../state/block-counter";
import { documentSemanticsField } from "../state/document-analysis";
import {
  createEditorState,
  makeBibStore,
  makeBlockPlugin,
} from "../test-utils";
import type { DocumentAnalysis } from "../semantics/document";
import {
  collectCitationMatchesFromAnalysis,
  getAnalysisCitationRegistrationKey,
} from "./citation-matching";
import { ensureCitationsRegistered } from "./citation-registration";
import type { CslProcessor } from "./csl-processor";

const store = makeBibStore([
  { id: "thm-main", type: "book", title: "Theorem as citation" },
  { id: "eq:main", type: "book", title: "Equation as citation" },
  { id: "sec-main", type: "book", title: "Heading as citation" },
  { id: "real-cite", type: "book", title: "Real citation" },
]);

function analyze(doc: string): DocumentAnalysis {
  return createEditorState(doc, {
    extensions: [
      markdown({
        extensions: [fencedDiv, mathExtension, equationLabelExtension],
      }),
      frontmatterField,
      documentSemanticsField,
      createPluginRegistryField([
        makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
      ]),
      blockCounterField,
    ],
  }).field(documentSemanticsField);
}

describe("citation registration precedence", () => {
  it("excludes block, equation, and heading targets that collide with bib keys", () => {
    const analysis = analyze([
      "# Intro",
      "",
      "## Section {#sec-main}",
      "",
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "$$x^2$$ {#eq:main}",
      "",
      "See [@thm-main], [@eq:main], [@sec-main], and [@real-cite].",
    ].join("\n"));

    const matches = collectCitationMatchesFromAnalysis(analysis, store);

    expect(matches).toEqual([
      { ids: ["real-cite"], locators: [undefined] },
    ]);
    expect(getAnalysisCitationRegistrationKey(analysis, store)).toBe("real-cite\0");
  });

  it("keeps real citations from mixed clusters while filtering local targets", () => {
    const analysis = analyze([
      "$$x^2$$ {#eq:main}",
      "",
      "See [@eq:main; @real-cite, p. 7].",
    ].join("\n"));

    expect(collectCitationMatchesFromAnalysis(analysis, store)).toEqual([
      { ids: ["real-cite"], locators: ["p. 7"] },
    ]);
  });

  it("registers only precedence-filtered citation clusters", () => {
    const analysis = analyze([
      "## Section {#sec-main}",
      "",
      "See [@sec-main; @real-cite].",
    ].join("\n"));
    const processor = {
      citationRegistrationKey: null,
      registerCitations: vi.fn(),
    } as unknown as CslProcessor;

    ensureCitationsRegistered(analysis, store, processor);

    expect(processor.registerCitations).toHaveBeenCalledWith([
      { ids: ["real-cite"], locators: [undefined] },
    ]);
  });
});
