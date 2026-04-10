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
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import {
  prepareDocumentLabelRename,
  resolveDocumentLabelRenameTarget,
} from "./document-label-rename";

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

function applyRename(state: EditorState, nextId: string): EditorState {
  const rename = prepareDocumentLabelRename(state, nextId);
  expect(rename.kind).toBe("ready");
  if (rename.kind !== "ready") {
    throw new Error(`expected ready rename, got ${rename.kind}`);
  }
  return state.update({ changes: [...rename.changes] }).state;
}

describe("resolveDocumentLabelRenameTarget", () => {
  it("requires the selection to stay inside an actual label token", () => {
    const doc = [
      "::: {.theorem #thm:main} Main Result",
      "Body.",
      ":::",
      "",
      "See [@thm:main].",
    ].join("\n");

    const state = createState(doc, doc.indexOf("Body."));

    expect(resolveDocumentLabelRenameTarget(state)).toEqual({ kind: "none" });
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
    const lookup = resolveDocumentLabelRenameTarget(state);

    expect(lookup.kind).toBe("duplicate");
    if (lookup.kind !== "duplicate") return;

    expect(lookup.id).toBe("dup");
    expect(lookup.definitions).toHaveLength(2);
  });

  it("ignores bibliography citations that are not local labels", () => {
    const doc = "See [@karger2000] and text.";
    const state = createState(doc, doc.indexOf("@karger2000") + 2);

    expect(resolveDocumentLabelRenameTarget(state)).toEqual({ kind: "none" });
  });
});

describe("prepareDocumentLabelRename", () => {
  it.each([
    {
      name: "heading ids from a narrative reference",
      doc: [
        "# Intro {#sec:intro}",
        "",
        "See @sec:intro.",
      ].join("\n"),
      selectionText: "@sec:intro",
      selectionOffset: 2,
      nextId: "sec:overview",
      expectedDoc: [
        "# Intro {#sec:overview}",
        "",
        "See @sec:overview.",
      ].join("\n"),
    },
    {
      name: "equation labels from the definition token",
      doc: [
        "$$",
        "x + y",
        "$$ {#eq:main}",
        "",
        "See [@eq:main].",
      ].join("\n"),
      selectionText: "{#eq:main}",
      selectionOffset: 3,
      nextId: "eq:sum",
      expectedDoc: [
        "$$",
        "x + y",
        "$$ {#eq:sum}",
        "",
        "See [@eq:sum].",
      ].join("\n"),
    },
    {
      name: "fenced-block labels from a bracketed reference",
      doc: [
        "::: {.theorem #thm:main} Main Result",
        "Body.",
        ":::",
        "",
        "See [@thm:main].",
      ].join("\n"),
      selectionText: "@thm:main",
      selectionOffset: 2,
      nextId: "thm:result",
      expectedDoc: [
        "::: {.theorem #thm:result} Main Result",
        "Body.",
        ":::",
        "",
        "See [@thm:result].",
      ].join("\n"),
    },
  ])("rewrites $name", ({ doc, selectionText, selectionOffset, nextId, expectedDoc }) => {
    const selection = doc.indexOf(selectionText) + selectionOffset;
    const state = createState(doc, selection);
    const renamed = applyRename(state, nextId);
    const graph = renamed.field(documentLabelGraphField);

    expect(renamed.doc.toString()).toBe(expectedDoc);
    expect(graph.uniqueDefinitionById.get(nextId)?.id).toBe(nextId);
  });

  it("preserves clustered-reference syntax and leaves citations untouched", () => {
    const doc = [
      "::: {.theorem #thm:main} Main Result",
      "Body.",
      ":::",
      "",
      "$$",
      "z",
      "$$ {#eq:other}",
      "",
      "See [@thm:main, p. 2; @eq:other] and @thm:main and [@karger2000].",
    ].join("\n");

    const state = createState(doc, doc.indexOf("@thm:main") + 2);
    const rename = prepareDocumentLabelRename(state, "thm:renamed");

    expect(rename.kind).toBe("ready");
    if (rename.kind !== "ready") return;

    expect(rename.referenceCount).toBe(2);

    const renamed = state.update({ changes: [...rename.changes] }).state;
    expect(renamed.doc.toString()).toBe([
      "::: {.theorem #thm:renamed} Main Result",
      "Body.",
      ":::",
      "",
      "$$",
      "z",
      "$$ {#eq:other}",
      "",
      "See [@thm:renamed, p. 2; @eq:other] and @thm:renamed and [@karger2000].",
    ].join("\n"));
  });

  it("rejects collisions with another local label", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "# Overview {#sec:overview}",
      "",
      "See @sec:intro.",
    ].join("\n");

    const state = createState(doc, doc.indexOf("@sec:intro") + 2);
    const rename = prepareDocumentLabelRename(state, "sec:overview");

    expect(rename.kind).toBe("invalid");
    if (rename.kind !== "invalid") return;

    expect(rename.validation.reason).toBe("collision");
  });
});
