import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../parser";
import { getPlugin } from "../plugins/plugin-registry";
import { createEditorState, makeBlockPlugin } from "../test-utils";
import { blockCounterField } from "./block-counter";
import {
  documentAnalysisField,
  documentSemanticsField,
} from "./document-analysis";
import { documentLabelGraphField } from "./document-label-graph";
import { frontmatterField } from "./frontmatter-state";
import { coreDocumentStateExtensions } from "./document-state-extensions";
import { pluginRegistryField } from "./plugin-registry";
import { referencePresentationField } from "../references/presentation";

describe("core document state extensions", () => {
  it("composes shared document state owners into one editor-ready bundle", () => {
    const doc = [
      "---",
      "blocks:",
      "  theorem:",
      "    title: Theorem",
      "---",
      "# Intro {#sec:intro}",
      "",
      "::: {.theorem #thm:one title=\"Main\"}",
      "Body",
      ":::",
      "",
      "See @sec:intro and @thm:one.",
    ].join("\n");
    const state = createEditorState(doc, {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        coreDocumentStateExtensions([
          makeBlockPlugin({ name: "theorem", title: "Theorem" }),
        ]),
      ],
    });

    expect(state.field(frontmatterField).config).toMatchObject({
      blocks: {
        theorem: {
          title: "Theorem",
        },
      },
    });
    expect(state.field(documentAnalysisField)).toBe(state.field(documentSemanticsField));
    expect(state.field(documentAnalysisField).headingByFrom.get(doc.indexOf("# Intro"))).toMatchObject({
      id: "sec:intro",
    });
    expect(getPlugin(state.field(pluginRegistryField), "theorem")).toBeDefined();
    expect(state.field(blockCounterField).byId.get("thm:one")).toMatchObject({
      number: 1,
    });
    expect(state.field(documentLabelGraphField).uniqueDefinitionById.get("sec:intro")).toBeDefined();
    expect(state.field(referencePresentationField, false)).toBeDefined();
  });
});
