import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorState } from "@codemirror/state";
import type { DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { CSS } from "../constants/css-classes";
import {
  ImageLoadingWidget,
  ImageWidget,
  PdfLoadingWidget,
  cursorImageRelationChanged,
  imageRenderPlugin,
  trackedCacheChanged,
} from "./image-render";
import { imageUrlEffect, imageUrlField } from "./image-url-cache";
import { pdfPreviewField } from "./pdf-preview-cache";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import { isPdfTarget, isRelativeFilePath } from "../lib/pdf-target";
import { createTestView, getDecorationSpecs } from "../test-utils";
import * as mediaPreview from "./media-preview";

describe("ImageWidget", () => {
  describe("createDOM", () => {
    it("produces a span wrapper with cf-image-wrapper class", () => {
      const widget = new ImageWidget("photo", "photo.png");
      const el = widget.createDOM();
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toBe(CSS.imageWrapper);
    });

    it("contains an img element with correct src and alt", () => {
      const widget = new ImageWidget("a cat", "images/cat.jpg");
      const el = widget.createDOM();
      const img = el.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.src).toContain("images/cat.jpg");
      expect(img!.alt).toBe("a cat");
    });

    it("sets cf-image class on the img element", () => {
      const widget = new ImageWidget("alt", "src.png");
      const el = widget.createDOM();
      const img = el.querySelector("img");
      expect(img!.className).toBe(CSS.image);
    });

    it("handles empty alt text", () => {
      const widget = new ImageWidget("", "img.png");
      const el = widget.createDOM();
      const img = el.querySelector("img");
      expect(img!.alt).toBe("");
    });
  });

  describe("eq", () => {
    it("returns true for same alt and src", () => {
      const a = new ImageWidget("cat", "cat.png");
      const b = new ImageWidget("cat", "cat.png");
      expect(a.eq(b)).toBe(true);
    });

    it("returns false when alt differs", () => {
      const a = new ImageWidget("cat", "photo.png");
      const b = new ImageWidget("dog", "photo.png");
      expect(a.eq(b)).toBe(false);
    });

    it("returns false when src differs", () => {
      const a = new ImageWidget("cat", "cat.png");
      const b = new ImageWidget("cat", "dog.png");
      expect(a.eq(b)).toBe(false);
    });

    it("returns false when both alt and src differ", () => {
      const a = new ImageWidget("cat", "cat.png");
      const b = new ImageWidget("dog", "dog.png");
      expect(a.eq(b)).toBe(false);
    });
  });

  describe("error handler", () => {
    it("sets cf-image-error class on load failure", () => {
      const widget = new ImageWidget("broken", "missing.png");
      const el = widget.createDOM();
      const img = el.querySelector("img")!;

      img.dispatchEvent(new Event("error"));

      expect(el.className).toBe(CSS.imageError);
      expect(el.textContent).toBe("[Image: broken]");
    });

    it("replaces img element with fallback text on error", () => {
      const widget = new ImageWidget("fallback alt", "bad.png");
      const el = widget.createDOM();
      const img = el.querySelector("img")!;

      img.dispatchEvent(new Event("error"));

      expect(el.querySelector("img")).toBeNull();
    });
  });
});

describe("PdfLoadingWidget", () => {
  describe("createDOM", () => {
    it("produces a span with cf-image-wrapper and cf-image-loading classes", () => {
      const widget = new PdfLoadingWidget("diagram");
      const el = widget.createDOM();
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toBe(`${CSS.imageWrapper} ${CSS.imageLoading}`);
    });

    it("shows loading text with alt text", () => {
      const widget = new PdfLoadingWidget("figure 1");
      const el = widget.createDOM();
      expect(el.textContent).toBe("[Loading PDF: figure 1]");
    });

    it("shows 'preview' when alt text is empty", () => {
      const widget = new PdfLoadingWidget("");
      const el = widget.createDOM();
      expect(el.textContent).toBe("[Loading PDF: preview]");
    });
  });

  describe("eq", () => {
    it("returns true for same alt text", () => {
      const a = new PdfLoadingWidget("fig");
      const b = new PdfLoadingWidget("fig");
      expect(a.eq(b)).toBe(true);
    });

    it("returns false when alt text differs", () => {
      const a = new PdfLoadingWidget("fig1");
      const b = new PdfLoadingWidget("fig2");
      expect(a.eq(b)).toBe(false);
    });
  });
});

describe("ImageLoadingWidget", () => {
  describe("createDOM", () => {
    it("produces a span with cf-image-wrapper and cf-image-loading classes", () => {
      const widget = new ImageLoadingWidget("diagram");
      const el = widget.createDOM();
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toBe(`${CSS.imageWrapper} ${CSS.imageLoading}`);
    });

    it("shows loading text with alt text", () => {
      const widget = new ImageLoadingWidget("figure 1");
      const el = widget.createDOM();
      expect(el.textContent).toBe("[Loading image: figure 1]");
    });

    it("shows 'preview' when alt text is empty", () => {
      const widget = new ImageLoadingWidget("");
      const el = widget.createDOM();
      expect(el.textContent).toBe("[Loading image: preview]");
    });
  });

  describe("eq", () => {
    it("returns true for same alt text", () => {
      const a = new ImageLoadingWidget("fig");
      const b = new ImageLoadingWidget("fig");
      expect(a.eq(b)).toBe(true);
    });

    it("returns false when alt text differs", () => {
      const a = new ImageLoadingWidget("fig1");
      const b = new ImageLoadingWidget("fig2");
      expect(a.eq(b)).toBe(false);
    });
  });
});

describe("isPdfTarget", () => {
  it("returns true for relative .pdf paths", () => {
    expect(isPdfTarget("figure.pdf")).toBe(true);
    expect(isPdfTarget("figures/diagram.pdf")).toBe(true);
    expect(isPdfTarget("./fig.pdf")).toBe(true);
    expect(isPdfTarget("../assets/plot.pdf")).toBe(true);
  });

  it("is case-insensitive for extension", () => {
    expect(isPdfTarget("Figure.PDF")).toBe(true);
    expect(isPdfTarget("test.Pdf")).toBe(true);
  });

  it("returns false for non-pdf extensions", () => {
    expect(isPdfTarget("photo.png")).toBe(false);
    expect(isPdfTarget("image.jpg")).toBe(false);
    expect(isPdfTarget("doc.pdf.bak")).toBe(false);
    expect(isPdfTarget("figure.svg")).toBe(false);
  });

  it("returns false for absolute http/https URLs", () => {
    expect(isPdfTarget("https://example.com/file.pdf")).toBe(false);
    expect(isPdfTarget("http://example.com/doc.pdf")).toBe(false);
    expect(isPdfTarget("HTTP://example.com/doc.pdf")).toBe(false);
  });

  it("returns false for data: URLs", () => {
    expect(isPdfTarget("data:application/pdf;base64,ABC")).toBe(false);
  });

  it("returns false for blob: URLs", () => {
    expect(isPdfTarget("blob:http://localhost/uuid.pdf")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isPdfTarget("")).toBe(false);
  });
});

/**
 * Regression test for #471: isRelativeFilePath must correctly distinguish
 * relative file paths (which need document-relative resolution) from
 * absolute URLs (which should be used as-is).
 */
describe("isRelativeFilePath", () => {
  it("returns true for relative file paths", () => {
    expect(isRelativeFilePath("photo.png")).toBe(true);
    expect(isRelativeFilePath("images/cat.jpg")).toBe(true);
    expect(isRelativeFilePath("./fig.svg")).toBe(true);
    expect(isRelativeFilePath("../assets/plot.png")).toBe(true);
  });

  it("returns false for http/https URLs", () => {
    expect(isRelativeFilePath("https://example.com/img.png")).toBe(false);
    expect(isRelativeFilePath("http://example.com/img.jpg")).toBe(false);
    expect(isRelativeFilePath("HTTP://example.com/img.jpg")).toBe(false);
  });

  it("returns false for data: URLs", () => {
    expect(isRelativeFilePath("data:image/png;base64,ABC")).toBe(false);
  });

  it("returns false for blob: URLs", () => {
    expect(isRelativeFilePath("blob:http://localhost/uuid")).toBe(false);
  });

  it("returns true for empty string", () => {
    // Empty string is not an absolute URL protocol
    expect(isRelativeFilePath("")).toBe(true);
  });
});

/**
 * Regression test for #471: non-PDF images must also use document-relative
 * path resolution, just like PDFs do. Before the fix, only PDF paths were
 * resolved via resolveProjectPathFromDocument; non-PDF images used the raw
 * markdown target, causing them to resolve relative to the app URL instead
 * of the document's directory.
 */
describe("Non-PDF image path resolution (#471)", () => {
  it("resolves a relative PNG path from a nested document", () => {
    // `![](diagram.png)` in `posts/math.md` should resolve to `posts/diagram.png`
    const resolved = resolveProjectPathFromDocument("posts/math.md", "diagram.png");
    expect(resolved).toBe("posts/diagram.png");
  });

  it("resolves a subdirectory-relative image from a nested document", () => {
    // `![](images/cat.jpg)` in `posts/math.md` → `posts/images/cat.jpg`
    const resolved = resolveProjectPathFromDocument("posts/math.md", "images/cat.jpg");
    expect(resolved).toBe("posts/images/cat.jpg");
  });

  it("produces distinct paths for same filename in different directories", () => {
    const fromPosts = resolveProjectPathFromDocument("posts/math.md", "diagram.png");
    const fromNotes = resolveProjectPathFromDocument("notes/physics.md", "diagram.png");
    expect(fromPosts).toBe("posts/diagram.png");
    expect(fromNotes).toBe("notes/diagram.png");
    expect(fromPosts).not.toBe(fromNotes);
  });

  it("does not resolve absolute URLs", () => {
    // Absolute URLs should be used as-is — isRelativeFilePath returns false
    expect(isRelativeFilePath("https://example.com/img.png")).toBe(false);
    // The image render plugin skips resolution for absolute URLs
  });
});

/**
 * Tests for the document-relative PDF path resolution used in image-render.ts.
 *
 * The image render plugin resolves relative PDF targets against the current
 * document path (via documentPathFacet + resolveProjectPathFromDocument) before
 * using them as cache keys and passing them to requestPdfPreview. This prevents
 * cache collisions when the same filename appears in different directories
 * (e.g., `posts/diagram.pdf` vs `notes/diagram.pdf`).
 *
 * Issue #437 reopened: raw markdown targets were passed directly to the cache,
 * so same-named PDFs from different directories would collide.
 */
describe("PDF path resolution for cache keys", () => {
  it("resolves a relative PDF path from a nested document", () => {
    // `![](diagram.pdf)` in `posts/math.md` should resolve to `posts/diagram.pdf`
    const resolved = resolveProjectPathFromDocument("posts/math.md", "diagram.pdf");
    expect(resolved).toBe("posts/diagram.pdf");
  });

  it("resolves a subdirectory-relative PDF path from a nested document", () => {
    // `![](figures/plot.pdf)` in `posts/math.md` → `posts/figures/plot.pdf`
    const resolved = resolveProjectPathFromDocument("posts/math.md", "figures/plot.pdf");
    expect(resolved).toBe("posts/figures/plot.pdf");
  });

  it("resolves ../ references correctly", () => {
    // `![](../shared/fig.pdf)` in `posts/math.md` → `shared/fig.pdf`
    const resolved = resolveProjectPathFromDocument("posts/math.md", "../shared/fig.pdf");
    expect(resolved).toBe("shared/fig.pdf");
  });

  it("treats leading-slash paths as project-root relative", () => {
    // `![](/assets/plot.pdf)` in any document → `assets/plot.pdf`
    const resolved = resolveProjectPathFromDocument("posts/math.md", "/assets/plot.pdf");
    expect(resolved).toBe("assets/plot.pdf");
  });

  it("produces distinct cache keys for same filename in different directories", () => {
    // This is the core regression test for the cache collision bug.
    // Two documents referencing `diagram.pdf` from different directories
    // must produce different resolved paths.
    const fromPosts = resolveProjectPathFromDocument("posts/math.md", "diagram.pdf");
    const fromNotes = resolveProjectPathFromDocument("notes/physics.md", "diagram.pdf");
    expect(fromPosts).toBe("posts/diagram.pdf");
    expect(fromNotes).toBe("notes/diagram.pdf");
    expect(fromPosts).not.toBe(fromNotes);
  });

  it("resolves identically for root-level documents", () => {
    // `![](diagram.pdf)` in `index.md` (at root) → `diagram.pdf`
    const resolved = resolveProjectPathFromDocument("index.md", "diagram.pdf");
    expect(resolved).toBe("diagram.pdf");
  });

  it("normalizes dot segments", () => {
    // `![](./figures/../figures/plot.pdf)` in `posts/math.md`
    const resolved = resolveProjectPathFromDocument("posts/math.md", "./figures/../figures/plot.pdf");
    expect(resolved).toBe("posts/figures/plot.pdf");
  });
});

// ── Targeted invalidation helpers (#580) ─────────────────────────────────────

describe("cursorImageRelationChanged", () => {
  const nodeRanges = [
    { from: 10, to: 30 },
    { from: 50, to: 70 },
  ];

  it("returns false when there are no image nodes", () => {
    expect(
      cursorImageRelationChanged([], true, true, 5, 5, 15, 15),
    ).toBe(false);
  });

  it("returns false when cursor moves but stays outside all image nodes", () => {
    expect(
      cursorImageRelationChanged(nodeRanges, true, true, 0, 0, 40, 40),
    ).toBe(false);
  });

  it("returns true when cursor moves into an image node", () => {
    expect(
      cursorImageRelationChanged(nodeRanges, true, true, 0, 0, 15, 15),
    ).toBe(true);
  });

  it("returns true when cursor moves out of an image node", () => {
    expect(
      cursorImageRelationChanged(nodeRanges, true, true, 15, 15, 40, 40),
    ).toBe(true);
  });

  it("returns false when cursor moves within the same image node", () => {
    expect(
      cursorImageRelationChanged(nodeRanges, true, true, 12, 12, 20, 20),
    ).toBe(false);
  });

  it("returns true when cursor moves between two image nodes", () => {
    expect(
      cursorImageRelationChanged(nodeRanges, true, true, 15, 15, 55, 55),
    ).toBe(true);
  });

  it("returns true when focus is lost while cursor is inside an image node", () => {
    expect(
      cursorImageRelationChanged(nodeRanges, true, false, 15, 15, 15, 15),
    ).toBe(true);
  });

  it("returns true when focus is gained while cursor is inside an image node", () => {
    expect(
      cursorImageRelationChanged(nodeRanges, false, true, 15, 15, 15, 15),
    ).toBe(true);
  });

  it("returns false when focus changes but cursor is outside all image nodes", () => {
    expect(
      cursorImageRelationChanged(nodeRanges, true, false, 40, 40, 40, 40),
    ).toBe(false);
  });

  it("handles selection ranges (not just cursors)", () => {
    // Selection from 12 to 25 is fully inside [10,30]
    expect(
      cursorImageRelationChanged(nodeRanges, true, true, 0, 0, 12, 25),
    ).toBe(true);
  });

  it("returns false when selection extends beyond node boundary", () => {
    // Selection 5→35 is NOT contained in [10,30] (from < node.from)
    expect(
      cursorImageRelationChanged(nodeRanges, true, true, 0, 0, 5, 35),
    ).toBe(false);
  });
});

describe("trackedCacheChanged", () => {
  it("returns false when both caches are identity-equal", () => {
    const cache = new Map([["a.pdf", { status: "loading" }]]);
    const paths = new Set(["a.pdf"]);
    expect(trackedCacheChanged(paths, cache, cache, cache, cache)).toBe(false);
  });

  it("returns false when tracked paths is empty", () => {
    const old = new Map([["a.pdf", { status: "loading" }]]);
    const updated = new Map([["a.pdf", { status: "ready" }]]);
    expect(trackedCacheChanged(new Set(), old, updated, old, old)).toBe(false);
  });

  it("detects tracked PDF path entry change (loading->ready)", () => {
    const entry1 = { status: "loading" };
    const entry2 = { status: "ready" };
    const oldPdf = new Map([["a.pdf", entry1]]);
    const newPdf = new Map([["a.pdf", entry2]]);
    const imgCache = new Map<string, unknown>();
    const paths = new Set(["a.pdf"]);
    expect(trackedCacheChanged(paths, oldPdf, newPdf, imgCache, imgCache)).toBe(true);
  });

  it("detects tracked image path entry change (loading->ready)", () => {
    const entry1 = { status: "loading" };
    const entry2 = { status: "ready" };
    const pdfCache = new Map<string, unknown>();
    const oldImg = new Map([["photo.png", entry1]]);
    const newImg = new Map([["photo.png", entry2]]);
    const paths = new Set(["photo.png"]);
    expect(trackedCacheChanged(paths, pdfCache, pdfCache, oldImg, newImg)).toBe(true);
  });

  it("ignores untracked path changes", () => {
    const entry1 = { status: "loading" };
    const entry2 = { status: "ready" };
    const oldPdf = new Map([["other.pdf", entry1]]);
    const newPdf = new Map([["other.pdf", entry2]]);
    const imgCache = new Map<string, unknown>();
    const paths = new Set(["a.pdf"]);
    expect(trackedCacheChanged(paths, oldPdf, newPdf, imgCache, imgCache)).toBe(false);
  });

  it("detects entry removal (eviction)", () => {
    const entry = { status: "ready" };
    const oldPdf = new Map([["a.pdf", entry]]);
    const newPdf = new Map<string, unknown>();
    const imgCache = new Map<string, unknown>();
    const paths = new Set(["a.pdf"]);
    expect(trackedCacheChanged(paths, oldPdf, newPdf, imgCache, imgCache)).toBe(true);
  });

  it("detects entry addition for tracked path", () => {
    const entry = { status: "loading" };
    const oldPdf = new Map<string, unknown>();
    const newPdf = new Map([["a.pdf", entry]]);
    const imgCache = new Map<string, unknown>();
    const paths = new Set(["a.pdf"]);
    expect(trackedCacheChanged(paths, oldPdf, newPdf, imgCache, imgCache)).toBe(true);
  });

  it("returns false when tracked path entry is same reference", () => {
    const entry = { status: "ready" };
    const oldPdf = new Map([["a.pdf", entry], ["b.pdf", { status: "loading" }]]);
    const newPdf = new Map([["a.pdf", entry], ["b.pdf", { status: "ready" }]]);
    const imgCache = new Map<string, unknown>();
    const paths = new Set(["a.pdf"]);
    expect(trackedCacheChanged(paths, oldPdf, newPdf, imgCache, imgCache)).toBe(false);
  });
});

describe("ImageRenderPlugin incremental docChanged (#824)", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    vi.restoreAllMocks();
  });

  function createImageView(doc: string): EditorView {
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown(), imageRenderPlugin],
    });
    return view;
  }

  it("does not rescan unchanged images when typing ordinary prose away from images", () => {
    const doc = [
      "![first](https://a.co/a.png)",
      "",
      "middle prose",
      "",
      "![second](https://a.co/b.png)",
      "",
      "tail",
    ].join("\n");
    const proseStart = doc.indexOf("middle prose");
    const resolvePreview = vi.spyOn(mediaPreview, "resolveLocalMediaPreview");

    const view = createImageView(doc);
    expect(view.dom.querySelectorAll(`.${CSS.imageWrapper}`)).toHaveLength(2);

    resolvePreview.mockClear();
    view.dispatch({
      changes: {
        from: proseStart + "middle ".length,
        insert: "fast ",
      },
    });

    expect(resolvePreview).not.toHaveBeenCalled();
    expect(view.dom.querySelectorAll(`.${CSS.imageWrapper}`)).toHaveLength(2);
  });

  it("rebuilds only the dirty image node when image syntax changes", () => {
    const doc = [
      "![first](https://example.com/a.png)",
      "",
      "middle prose",
      "",
      "![second](https://example.com/b.png)",
      "",
      "tail text",
    ].join("\n");
    const oldUrl = "https://example.com/a.png";
    const nextUrl = "https://example.com/updated.png";
    const resolvePreview = vi.spyOn(mediaPreview, "resolveLocalMediaPreview");

    const view = createImageView(doc);
    resolvePreview.mockClear();

    view.dispatch({
      changes: {
        from: doc.indexOf(oldUrl),
        to: doc.indexOf(oldUrl) + oldUrl.length,
        insert: nextUrl,
      },
    });

    expect(resolvePreview).toHaveBeenCalledTimes(1);
    expect(resolvePreview.mock.calls[0]?.[1]).toBe(nextUrl);

    const renderedSources = [...view.dom.querySelectorAll(`.${CSS.imageWrapper} img`)]
      .map((img) => img.getAttribute("src"));
    expect(renderedSources.some((src) => src?.includes("updated.png"))).toBe(true);
    expect(renderedSources.some((src) => src?.includes("b.png"))).toBe(true);
  });

  it("removes stale widgets when an image node is destroyed", () => {
    const doc = [
      "![first](https://example.com/a.png)",
      "",
      "middle prose",
      "",
      "![second](https://example.com/b.png)",
      "",
      "tail text",
    ].join("\n");

    const view = createImageView(doc);
    expect(view.dom.querySelectorAll(`.${CSS.imageWrapper}`)).toHaveLength(2);

    view.dispatch({
      changes: { from: 0, to: 1, insert: "" },
    });

    const renderedSources = [...view.dom.querySelectorAll(`.${CSS.imageWrapper} img`)]
      .map((img) => img.getAttribute("src"));
    expect(view.dom.querySelectorAll(`.${CSS.imageWrapper}`)).toHaveLength(1);
    expect(renderedSources).toHaveLength(1);
    expect(renderedSources[0]).toContain("b.png");
  });
});

interface ImageRenderPluginProbe {
  decorations: DecorationSet;
  coveredRanges: Array<{ from: number; to: number }>;
  rebuild(view: EditorView): void;
  update(update: ViewUpdate): void;
}

describe("ImageRenderPlugin incremental viewportChanged (#875)", () => {
  let view: EditorView | undefined;

  function getPluginProbe(): ImageRenderPluginProbe {
    const plugin = view?.plugin(imageRenderPlugin as unknown as ViewPlugin<ImageRenderPluginProbe>);
    expect(plugin).toBeTruthy();
    if (!plugin) throw new Error("expected image render plugin instance");
    return plugin;
  }

  function setVisibleRanges(
    ranges: readonly { from: number; to: number }[],
  ): (next: readonly { from: number; to: number }[]) => void {
    if (!view) throw new Error("expected test view");
    let current = ranges;
    Object.defineProperty(view, "visibleRanges", {
      configurable: true,
      get: () => current,
    });
    return (next) => {
      current = next;
    };
  }

  function mockViewportUpdate(): ViewUpdate {
    if (!view) throw new Error("expected test view");
    const currentView = view;
    const state = Object.create(currentView.state) as EditorState;
    Object.defineProperty(state, "field", {
      configurable: true,
      value: (field: unknown, require = true) => {
        if (field === pdfPreviewField || field === imageUrlField) {
          return currentView.state.field(field as never, false) ?? new Map();
        }
        return currentView.state.field(field as never, require as never);
      },
    });
    return {
      docChanged: false,
      selectionSet: false,
      focusChanged: false,
      viewportChanged: true,
      state,
      startState: state,
      view: currentView,
    } as unknown as ViewUpdate;
  }

  afterEach(() => {
    view?.destroy();
    view = undefined;
    vi.restoreAllMocks();
  });

  it("keeps viewport tracking bounded to the current visible images when scrolling", () => {
    const doc = [
      "![first](first.png)",
      "",
      "x".repeat(70),
      "",
      "![second](second.png)",
      "",
      "y".repeat(70),
      "",
      "![third](third.png)",
      "",
      "tail text",
    ].join("\n");
    const secondStart = doc.indexOf("![second]");
    const resolvePreview = vi.spyOn(mediaPreview, "resolveLocalMediaPreview").mockImplementation(
      (_view, src) => ({ kind: "image", resolvedPath: src, dataUrl: `data:${src}` }),
    );

    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown(), imageRenderPlugin],
    });
    const plugin = getPluginProbe();
    const initialRanges = [{ from: 0, to: secondStart + 5 }];
    const scrolledRanges = [{ from: secondStart + 2, to: doc.length }];
    const setRanges = setVisibleRanges(initialRanges);

    plugin.rebuild(view);
    expect(plugin.coveredRanges).toEqual(initialRanges);
    expect(getDecorationSpecs(plugin.decorations).filter((spec) => spec.from === secondStart))
      .toHaveLength(1);

    resolvePreview.mockClear();
    setRanges(scrolledRanges);
    plugin.update(mockViewportUpdate());
    expect(resolvePreview).toHaveBeenCalledTimes(1);
    expect(resolvePreview.mock.calls[0]?.[1]).toBe("third.png");
    expect(plugin.coveredRanges).toEqual(scrolledRanges);
    expect(getDecorationSpecs(plugin.decorations).filter((spec) => spec.from === secondStart))
      .toHaveLength(1);

    resolvePreview.mockClear();
    setRanges(initialRanges);
    plugin.update(mockViewportUpdate());
    expect(resolvePreview).toHaveBeenCalledTimes(1);
    expect(resolvePreview.mock.calls[0]?.[1]).toBe("first.png");
    expect(plugin.coveredRanges).toEqual(initialRanges);
    expect(getDecorationSpecs(plugin.decorations).filter((spec) => spec.from === secondStart))
      .toHaveLength(1);
  });
});

describe("imageRenderPlugin cache-only invalidation", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    vi.restoreAllMocks();
  });

  it("rebuilds only the visible local preview whose cache entry changed", () => {
    const doc = [
      "![first](first.png)",
      "",
      "![second](second.png)",
    ].join("\n");
    const resolvePreview = vi.spyOn(mediaPreview, "resolveLocalMediaPreview").mockImplementation(
      (_view, src) => ({ kind: "loading", resolvedPath: src, isPdf: false }),
    );

    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown(), imageUrlField, pdfPreviewField, imageRenderPlugin],
    });
    resolvePreview.mockClear();

    view.dispatch({
      effects: imageUrlEffect.of({ path: "first.png", entry: { status: "loading" } }),
    });

    expect(resolvePreview).toHaveBeenCalledTimes(1);
    expect(resolvePreview.mock.calls[0]?.[1]).toBe("first.png");
  });
});
