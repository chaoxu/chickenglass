import { describe, it, expect } from "vitest";
import { CSS } from "../constants/css-classes";
import { ImageLoadingWidget, ImageWidget, PdfLoadingWidget } from "./image-render";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import { isPdfTarget, isRelativeFilePath } from "../lib/pdf-target";

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
