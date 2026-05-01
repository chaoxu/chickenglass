import { type Extension, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bibDataField } from "../state/bib-data";
import {
  createMarkdownLanguageExtensions,
} from "../editor/base-editor-extensions";
import { frontmatterField } from "../state/frontmatter-state";
import { documentPathFacet } from "../lib/types";
import {
  defaultPlugins,
} from "../plugins";
import { documentAnalysisField } from "../state/document-analysis";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import { mathMacrosField } from "../state/math-macros";

const resolveLocalMediaPreviewMock = vi.fn();
const { getPdfCanvasMock } = vi.hoisted(() => ({
  getPdfCanvasMock: vi.fn(),
}));

vi.mock("./media-preview", async () => {
  const actual = await vi.importActual<typeof import("./media-preview")>("./media-preview");
  return {
    ...actual,
    resolveLocalMediaPreview: (view: EditorView, src: string) =>
      resolveLocalMediaPreviewMock(view, src),
  };
});

vi.mock("./pdf-preview-cache", async () => {
  const actual = await vi.importActual<typeof import("./pdf-preview-cache")>("./pdf-preview-cache");
  return {
    ...actual,
    getPdfCanvas: (path: string) => getPdfCanvasMock(path),
  };
});

const { buildBlockPreviewBodyForTest, normalizeWidePreviewContentForTest } = await import("./hover-preview");

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
      frontmatterField,
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
    getPdfCanvasMock.mockReset();
  });

  it("renders full table block structure with caption wrapper", () => {
    const view = createPreviewView(
      [
        '::: {#tbl:main .table title="Results table"}',
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        ":::",
      ].join("\n"),
    );

    const body = buildBlockPreviewBodyForTest(view, getNumberedBlock(view, "tbl:main"));
    expect(body?.querySelector(".cf-hover-preview-table-scroll")).toBeTruthy();
    expect(body?.querySelector(".cf-hover-preview-table-scroll table")).toBeTruthy();
    expect(body?.querySelector(".cf-block-caption")?.textContent).toContain("Results table");

    view.destroy();
  });

  it("marks fenced code blocks with the explicit preview overflow class", () => {
    const body = document.createElement("div");
    body.innerHTML = '<pre><code class="language-typescript">const veryLongIdentifierWithoutAnyBreaks = "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz";</code></pre>';
    normalizeWidePreviewContentForTest(body);
    expect(body?.querySelector("pre.cf-hover-preview-code-block > code.language-typescript")).toBeTruthy();
  });

  it("uses resolved local media overrides for figure previews", () => {
    resolveLocalMediaPreviewMock.mockReturnValue({
      kind: "image",
      resolvedPath: "notes/fig.png",
      dataUrl: "data:image/png;base64,FIG",
    });

    const view = createPreviewView(
      [
        '::: {#fig:main .figure title="Figure caption"}',
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
        '::: {#fig:main .figure title="Figure caption"}',
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

  it("renders cached PDF figure previews as canvases without PNG re-encoding", () => {
    const cachedCanvas = document.createElement("canvas");
    const toDataUrl = vi.fn(() => "data:image/png;base64,SHOULD_NOT_BE_USED");
    Object.defineProperty(cachedCanvas, "toDataURL", {
      configurable: true,
      value: toDataUrl,
    });

    resolveLocalMediaPreviewMock.mockReturnValue({
      kind: "pdf-canvas",
      resolvedPath: "notes/fig.pdf",
    });
    getPdfCanvasMock.mockReturnValue(cachedCanvas);

    const view = createPreviewView(
      [
        '::: {#fig:main .figure title="Figure caption"}',
        "",
        "![Preview PDF](fig.pdf)",
        ":::",
      ].join("\n"),
      [documentPathFacet.of("notes/main.md")],
    );

    const body = buildBlockPreviewBodyForTest(view, getNumberedBlock(view, "fig:main"));
    const pdfCanvas = body?.querySelector(".cf-block-figure canvas");

    expect(pdfCanvas).toBeTruthy();
    expect(pdfCanvas?.getAttribute("aria-label")).toBe("Preview PDF");
    expect(body?.querySelector(".cf-block-figure img")).toBeNull();
    expect(toDataUrl).not.toHaveBeenCalled();

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
        '::: {#fig:main .figure title="Figure caption"}',
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
