import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { documentPathFacet, fileSystemFacet, type FileSystem } from "../lib/types";
import { createTestView } from "../test-utils";
import { pdfPreviewField } from "./pdf-preview-cache";
import {
  imageUrlField,
  getImageUrl,
  clearImageUrl,
  resetImageUrlState,
  invalidateImagePath,
  requestImageUrl,
  _resetImageUrlCache,
} from "./image-url-cache";
import { ImageWidget, PdfLoadingWidget, imageRenderPlugin } from "./image-render";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import { isPdfTarget, isRelativeFilePath } from "../lib/pdf-target";

function createMockFs(): FileSystem {
  return {
    listTree: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createFile: vi.fn(),
    exists: vi.fn(),
    renameFile: vi.fn(),
    createDirectory: vi.fn(),
    deleteFile: vi.fn(),
    writeFileBinary: vi.fn(),
    readFileBinary: vi.fn().mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
  };
}

function createMockView() {
  let state = EditorState.create({
    doc: "",
    extensions: [imageUrlField],
  });

  const view = {
    get state() {
      return state;
    },
    dispatch(tr: { effects?: unknown }) {
      state = state.update(tr as Parameters<EditorState["update"]>[0]).state;
    },
    dom: { isConnected: true },
  };

  return view as unknown as import("@codemirror/view").EditorView;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function setVisibleRange(view: EditorView): void {
  Object.defineProperty(view, "visibleRanges", {
    configurable: true,
    value: [{ from: 0, to: view.state.doc.length }],
  });
}

const createObjectUrlMock = vi.fn();
const revokeObjectUrlMock = vi.fn();
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

beforeEach(() => {
  createObjectUrlMock.mockReset();
  createObjectUrlMock.mockReturnValue("blob:coflat-image");
  revokeObjectUrlMock.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: createObjectUrlMock,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revokeObjectUrlMock,
  });
});

afterEach(() => {
  _resetImageUrlCache();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: originalRevokeObjectUrl,
  });
});

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

describe("image URL cache invalidation", () => {
  it("removes the current path from editor state when invalidated", async () => {
    const fs = createMockFs();
    const view = createMockView();

    await requestImageUrl(view, "posts/diagram.png", fs);

    expect(getImageUrl("posts/diagram.png")).toBe("blob:coflat-image");
    expect(view.state.field(imageUrlField).get("posts/diagram.png")?.status).toBe("ready");

    invalidateImagePath(view, "posts/diagram.png");

    expect(getImageUrl("posts/diagram.png")).toBeUndefined();
    expect(view.state.field(imageUrlField).has("posts/diagram.png")).toBe(false);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:coflat-image");
  });

  it("clears pending requests when the cache resets", async () => {
    const firstRead = createDeferred<Uint8Array>();
    const secondRead = createDeferred<Uint8Array>();
    const fs = createMockFs();
    fs.readFileBinary = vi.fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    const firstView = createMockView();
    const secondView = createMockView();

    const firstRequest = requestImageUrl(firstView, "posts/diagram.png", fs);
    await vi.waitFor(() => {
      expect(fs.readFileBinary).toHaveBeenCalledTimes(1);
    });

    resetImageUrlState(firstView);
    expect(firstView.state.field(imageUrlField).has("posts/diagram.png")).toBe(false);

    const secondRequest = requestImageUrl(secondView, "posts/diagram.png", fs);
    await vi.waitFor(() => {
      expect(fs.readFileBinary).toHaveBeenCalledTimes(2);
    });

    firstRead.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    secondRead.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await firstRequest;
    await secondRequest;
  });

  it("drops stale in-flight requests after invalidation", async () => {
    const staleRead = createDeferred<Uint8Array>();
    const freshRead = createDeferred<Uint8Array>();
    const fs = createMockFs();
    fs.readFileBinary = vi.fn()
      .mockImplementationOnce(() => staleRead.promise)
      .mockImplementationOnce(() => freshRead.promise);
    createObjectUrlMock
      .mockReset()
      .mockReturnValueOnce("blob:fresh-image")
      .mockReturnValueOnce("blob:stale-image");
    const view = createMockView();

    const staleRequest = requestImageUrl(view, "posts/diagram.png", fs);
    await vi.waitFor(() => {
      expect(fs.readFileBinary).toHaveBeenCalledTimes(1);
    });

    invalidateImagePath(view, "posts/diagram.png");
    const freshRequest = requestImageUrl(view, "posts/diagram.png", fs);
    await vi.waitFor(() => {
      expect(fs.readFileBinary).toHaveBeenCalledTimes(2);
    });

    freshRead.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await freshRequest;
    expect(getImageUrl("posts/diagram.png")).toBe("blob:fresh-image");

    staleRead.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await staleRequest;

    expect(getImageUrl("posts/diagram.png")).toBe("blob:fresh-image");
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:stale-image");
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

describe("requestImageUrl (#471)", () => {
  it("loads relative non-PDF images into the cache using the resolved document path", async () => {
    const fs = createMockFs();
    const view = createMockView();
    const resolvedPath = resolveProjectPathFromDocument("posts/math.md", "diagram.png");

    await requestImageUrl(view, resolvedPath, fs);

    expect((fs.readFileBinary as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("posts/diagram.png");
    expect(view.state.field(imageUrlField).get("posts/diagram.png")?.status).toBe("ready");
    expect(getImageUrl("posts/diagram.png")).toBe("blob:coflat-image");
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
  });

  it("can invalidate a cached image path so it will be re-read later", async () => {
    const fs = createMockFs();
    const view = createMockView();

    await requestImageUrl(view, "posts/diagram.png", fs);
    expect(getImageUrl("posts/diagram.png")).toBe("blob:coflat-image");

    clearImageUrl("posts/diagram.png");

    expect(getImageUrl("posts/diagram.png")).toBeUndefined();
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:coflat-image");
  });
});

describe("imageRenderPlugin (#471)", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
  });

  it("resolves document-relative image paths and preserves src suffixes", async () => {
    const fs = createMockFs();
    view = createTestView("Intro\n\n![Diagram](diagram.png#fragment)\n", {
      cursorPos: 0,
      extensions: [
        markdown(),
        pdfPreviewField,
        imageUrlField,
        imageRenderPlugin,
        fileSystemFacet.of(fs),
        documentPathFacet.of("posts/math.md"),
      ],
    });
    setVisibleRange(view);
    view.dispatch({ selection: { anchor: 1 } });

    await vi.waitFor(() => {
      expect((fs.readFileBinary as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("posts/diagram.png");
      expect(view?.state.field(imageUrlField).get("posts/diagram.png")?.status).toBe("ready");
    });
  });
});
