import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { frontmatterField } from "../editor/frontmatter-state";
import { markdownExtensions } from "../parser";
import {
  defaultPlugins,
} from "../plugins";
import { documentAnalysisField } from "../state/document-analysis";
import { documentLabelGraphField } from "../state/document-label-graph";
import { resolveDocumentLabelBacklinks } from "./document-label-backlinks";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";

function createState(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [
      frontmatterField,
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
      createPluginRegistryField(defaultPlugins),
      blockCounterField,
      documentLabelGraphField,
    ],
  });
}

describe("resolveDocumentLabelBacklinks", () => {
  it("resolves local backlinks from a reference token and includes context", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "::: {.theorem #thm:main} Main Result",
      "Body.",
      ":::",
      "",
      "$$",
      "x + y",
      "$$ {#eq:main}",
      "",
      "See [@thm:main, p. 2; @eq:main] and @sec:intro and [@karger2000].",
    ].join("\n");

    const state = createState(doc, doc.indexOf("@thm:main") + 2);
    const lookup = resolveDocumentLabelBacklinks(state);

    expect(lookup.kind).toBe("ready");
    if (lookup.kind !== "ready") return;

    expect(lookup.result.source).toBe("reference");
    expect(lookup.result.definition).toMatchObject({
      id: "thm:main",
      displayLabel: "Theorem 1",
    });
    expect(lookup.result.backlinks).toEqual([
      {
        from: doc.indexOf("@thm:main"),
        to: doc.indexOf("@thm:main") + "@thm:main".length,
        lineNumber: 11,
        referenceText: "@thm:main",
        contextText: "See [@thm:main, p. 2; @eq:main] and @sec:intro and [@karger2000].",
        locator: "p. 2",
      },
    ]);
  });

  it("resolves local backlinks from the target definition range", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "::: {.theorem #thm:main} Main Result",
      "Body.",
      ":::",
      "",
      "See [@thm:main].",
    ].join("\n");

    const state = createState(doc, doc.indexOf("Body."));
    const lookup = resolveDocumentLabelBacklinks(state);

    expect(lookup.kind).toBe("ready");
    if (lookup.kind !== "ready") return;

    expect(lookup.result.source).toBe("definition");
    expect(lookup.result.definition.id).toBe("thm:main");
    expect(lookup.result.backlinks).toHaveLength(1);
    expect(lookup.result.backlinks[0]).toMatchObject({
      referenceText: "@thm:main",
      lineNumber: 7,
    });
  });

  it("ignores bibliography citations that are not local labels", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "See [@karger2000] and @sec:intro.",
    ].join("\n");

    const state = createState(doc, doc.indexOf("@karger2000") + 2);

    expect(resolveDocumentLabelBacklinks(state)).toEqual({ kind: "none" });
  });

  it("reports duplicate local labels instead of choosing one arbitrarily", () => {
    const doc = [
      "# Intro {#dup}",
      "",
      "::: {.theorem #dup} Duplicate",
      "Body.",
      ":::",
      "",
      "See [@dup].",
    ].join("\n");

    const state = createState(doc, doc.indexOf("@dup") + 2);
    const lookup = resolveDocumentLabelBacklinks(state);

    expect(lookup.kind).toBe("duplicate");
    if (lookup.kind !== "duplicate") return;

    expect(lookup.id).toBe("dup");
    expect(lookup.definitions).toHaveLength(2);
  });

  it("returns an explicit empty backlink set for unreferenced local labels", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "Paragraph.",
    ].join("\n");

    const selectionFrom = doc.indexOf("sec:intro");
    const selectionTo = selectionFrom + "sec:intro".length;
    const state = createState(doc, selectionFrom, selectionTo);
    const lookup = resolveDocumentLabelBacklinks(state);

    expect(lookup.kind).toBe("ready");
    if (lookup.kind !== "ready") return;

    expect(lookup.result.source).toBe("definition");
    expect(lookup.result.definition.id).toBe("sec:intro");
    expect(lookup.result.backlinks).toEqual([]);
  });
});
