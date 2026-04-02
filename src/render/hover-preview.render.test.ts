import { type Extension, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bibDataField } from "../citations/citation-render";
import {
  createMarkdownLanguageExtensions,
  sharedDocumentStateExtensions,
} from "../editor/base-editor-extensions";
import { documentPathFacet } from "../lib/types";
import {
  blockCounterField,
  createPluginRegistryField,
  defaultPlugins,
} from "../plugins";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { mathMacrosField } from "./math-macros";

const resolveLocalMediaPreviewMock = vi.fn();

vi.mock("./media-preview", () => ({
  resolveLocalMediaPreview: (view: EditorView, src: string) =>
    resolveLocalMediaPreviewMock(view, src),
}));

const { buildBlockPreviewBodyForTest } = await import("./hover-preview");

function createPreviewView(
  doc: string,
  extraExtensions: readonly Extension[] = [],
): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    extensions: [
      ...createMarkdownLanguageExtensions(),
      ...sharedDocumentStateExtensions,
      documentAnalysisField,
      bibDataField,
      createPluginRegistryField(defaultPlugins),
      blockCounterField,
      mathMacrosField,
      ...extraExtensions,
    ],
  });
  return new EditorView({ state, parent });
}

function getNumberedBlock(view: EditorView, id: string) {
  const block = view.state.field(blockCounterField).byId.get(id);
  expect(block).toBeDefined();
  if (!block) {
    throw new Error(`Expected numbered block ${id}`);
  }
  return block;
}

describe("hover preview block rendering", () => {
  beforeEach(() => {
    resolveLocalMediaPreviewMock.mockReset();
    resolveLocalMediaPreviewMock.mockReturnValue(null);
  });

  it("renders full table block structure with caption wrapper", () => {
    const view = createPreviewView(
      [
        "::: {#tbl:main .table} Results table",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        ":::",
      ].join("\n"),
    );

    const body = buildBlockPreviewBodyForTest(view, getNumberedBlock(view, "tbl:main"));
    expect(body?.querySelector(".cf-block-table table")).toBeTruthy();
    expect(body?.querySelector(".cf-block-caption")?.textContent).toContain("Results table");

    view.destroy();
  });

  it("uses resolved local media overrides for figure previews", () => {
    resolveLocalMediaPreviewMock.mockReturnValue({
      kind: "image",
      resolvedPath: "notes/fig.png",
      dataUrl: "data:image/png;base64,FIG",
    });

    const view = createPreviewView(
      [
        "::: {#fig:main .figure} Figure caption",
        "",
        "![Figure](fig.png)",
        ":::",
      ].join("\n"),
      [documentPathFacet.of("notes/main.md")],
    );

    const body = buildBlockPreviewBodyForTest(view, getNumberedBlock(view, "fig:main"));
    const image = body?.querySelector(".cf-block-figure img");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,FIG");
    expect(body?.querySelector(".cf-block-caption")?.textContent).toContain("Figure caption");

    view.destroy();
  });

  it("falls back to caption plus source text when local figure media is unavailable", () => {
    resolveLocalMediaPreviewMock.mockReturnValue({
      kind: "error",
      resolvedPath: "notes/fig.pdf",
      fallbackSrc: "fig.pdf",
    });

    const view = createPreviewView(
      [
        "::: {#fig:main .figure} Figure caption",
        "",
        "![Figure](fig.pdf)",
        ":::",
      ].join("\n"),
      [documentPathFacet.of("notes/main.md")],
    );

    const body = buildBlockPreviewBodyForTest(view, getNumberedBlock(view, "fig:main"));
    expect(body?.querySelector(".cf-block-caption")?.textContent).toContain("Figure caption");
    expect(body?.querySelector(".cf-block-figure img")).toBeNull();
    expect(body?.textContent).toContain("Preview unavailable: fig.pdf");

    view.destroy();
  });

  it("shows a loading fallback while local figure media is still pending", () => {
    resolveLocalMediaPreviewMock.mockReturnValue({
      kind: "loading",
      resolvedPath: "notes/fig.png",
      isPdf: false,
    });

    const view = createPreviewView(
      [
        "::: {#fig:main .figure} Figure caption",
        "",
        "![Figure](fig.png)",
        ":::",
      ].join("\n"),
      [documentPathFacet.of("notes/main.md")],
    );

    const body = buildBlockPreviewBodyForTest(view, getNumberedBlock(view, "fig:main"));
    expect(body?.querySelector(".cf-block-figure img")).toBeNull();
    expect(body?.textContent).toContain("Loading preview: fig.png");

    view.destroy();
  });
});
