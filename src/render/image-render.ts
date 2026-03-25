import { type Extension } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  buildDecorations,
  collectNodeRangesExcludingCursor,
  defaultShouldUpdate,
  pushWidgetDecoration,
  RenderWidget,
  createSimpleViewPlugin,
} from "./render-utils";
import { pdfPreviewField, requestPdfPreview, getPdfCanvas } from "./pdf-preview-cache";
import { fileSystemFacet, documentPathFacet } from "../lib/types";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import { isPdfTarget } from "../lib/pdf-target";
import { CSS } from "../constants/css-classes";

// ── Widgets ───────────────────────────────────────────────────────────────────

/** Widget that renders an inline image. */
export class ImageWidget extends RenderWidget {
  constructor(
    private readonly alt: string,
    private readonly src: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = CSS.imageWrapper;

    const img = document.createElement("img");
    img.className = CSS.image;
    img.src = this.src;
    img.alt = this.alt;
    img.addEventListener("error", () => {
      wrapper.textContent = `[Image: ${this.alt}]`;
      wrapper.className = CSS.imageError;
    });

    wrapper.appendChild(img);
    return wrapper;
  }

  eq(other: ImageWidget): boolean {
    return this.alt === other.alt && this.src === other.src;
  }
}

/** Widget that wraps a pre-rendered PDF canvas element directly. */
export class PdfCanvasWidget extends RenderWidget {
  constructor(
    private readonly alt: string,
    private readonly path: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = CSS.imageWrapper;

    const canvas = getPdfCanvas(this.path);
    if (canvas) {
      // Clone the canvas so each widget instance owns its own DOM element
      const clone = document.createElement("canvas");
      clone.width = canvas.width;
      clone.height = canvas.height;
      clone.style.maxWidth = "100%";
      clone.style.height = "auto";
      clone.setAttribute("role", "img");
      clone.setAttribute("aria-label", this.alt);
      const ctx = clone.getContext("2d");
      if (ctx) ctx.drawImage(canvas, 0, 0);
      wrapper.appendChild(clone);
    } else {
      wrapper.textContent = `[Image: ${this.alt}]`;
      wrapper.className = CSS.imageError;
    }

    return wrapper;
  }

  eq(other: PdfCanvasWidget): boolean {
    return this.alt === other.alt && this.path === other.path;
  }
}

/** Widget that shows a loading placeholder while a PDF preview is rasterizing. */
export class PdfLoadingWidget extends RenderWidget {
  constructor(private readonly alt: string) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = `${CSS.imageWrapper} ${CSS.imageLoading}`;
    wrapper.textContent = `[Loading PDF: ${this.alt || "preview"}]`;
    return wrapper;
  }

  eq(other: PdfLoadingWidget): boolean {
    return this.alt === other.alt;
  }
}

// ── Syntax helpers ────────────────────────────────────────────────────────────

/** Read alt/src from an Image syntax node. */
function readImageContent(
  view: EditorView,
  node: SyntaxNode,
): { alt: string; src: string } | null {
  const urlNode = node.getChild("URL");
  if (!urlNode) return null;

  const src = view.state.sliceDoc(urlNode.from, urlNode.to);
  if (!src) return null;

  const marks = node.getChildren("LinkMark");
  const alt = marks.length >= 2
    ? view.state.sliceDoc(marks[0].to, marks[1].from)
    : "";

  return { alt, src };
}

// ── Decoration builder ────────────────────────────────────────────────────────

const IMAGE_TYPES = new Set(["Image"]);

/** Collect decoration ranges for images outside the cursor. */
function collectImageRanges(view: EditorView) {
  return collectNodeRangesExcludingCursor(view, IMAGE_TYPES, (node, items) => {
    const parsed = readImageContent(view, node.node);
    if (!parsed) return;

    if (isPdfTarget(parsed.src)) {
      // Resolve the raw markdown target relative to the current document,
      // so that `![](diagram.pdf)` in `posts/math.md` resolves to
      // `posts/diagram.pdf`. The resolved path is used as cache key to
      // prevent collisions between same-named PDFs in different directories.
      const docPath = view.state.facet(documentPathFacet);
      const resolvedPath = resolveProjectPathFromDocument(docPath, parsed.src);

      // PDF target — resolve from the preview cache
      const cache = view.state.field(pdfPreviewField);
      const entry = cache.get(resolvedPath);

      if (entry?.status === "ready") {
        // Rasterized — render the canvas directly
        pushWidgetDecoration(items, new PdfCanvasWidget(parsed.alt, resolvedPath), node.from, node.to);
      } else if (entry?.status === "error") {
        // Error — show the existing broken-image fallback
        pushWidgetDecoration(items, new ImageWidget(parsed.alt, parsed.src), node.from, node.to);
      } else {
        // Loading or not yet requested — show loading placeholder
        pushWidgetDecoration(items, new PdfLoadingWidget(parsed.alt), node.from, node.to);

        // Trigger async preview request if not yet in cache
        if (!entry) {
          const fs = view.state.facet(fileSystemFacet);
          if (fs) {
            void requestPdfPreview(view, resolvedPath, fs);
          }
        }
      }
    } else {
      // Normal image — unchanged
      pushWidgetDecoration(items, new ImageWidget(parsed.alt, parsed.src), node.from, node.to);
    }
  });
}

/** Build a DecorationSet for images (convenience wrapper). */
function imageDecorations(view: EditorView): DecorationSet {
  return buildDecorations(collectImageRanges(view));
}

/**
 * Custom shouldUpdate that also triggers on pdfPreviewField changes,
 * so the plugin re-renders when a PDF preview becomes ready.
 */
function imageShouldUpdate(update: ViewUpdate): boolean {
  if (defaultShouldUpdate(update)) return true;

  // Re-render when the PDF preview cache has been updated
  const oldCache = update.startState.field(pdfPreviewField);
  const newCache = update.state.field(pdfPreviewField);
  return oldCache !== newCache;
}

/** CM6 extension that renders inline images with Typora-style click-to-edit. */
export const imageRenderPlugin: Extension = createSimpleViewPlugin(
  imageDecorations,
  { shouldUpdate: imageShouldUpdate },
);
