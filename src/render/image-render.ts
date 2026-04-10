import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  type Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  buildDecorations,
  pushBlockWidgetDecoration,
  pushWidgetDecoration,
} from "./decoration-core";
import { RenderWidget } from "./source-widget";
import {
  clearActiveFenceGuideClasses,
  syncActiveFenceGuideClasses,
} from "./source-widget";
import { ShellWidget } from "./shell-widget";
import { imageUrlField } from "./image-url-cache";
import { getPdfCanvas, pdfPreviewField } from "./pdf-preview-cache";
import {
  clearBlockWidgetHeightBinding,
  estimatedBlockWidgetHeight,
  observeBlockWidgetHeight,
  type BlockWidgetHeightBinding,
} from "./block-widget-height";
import {
  resolveLocalMediaPreview,
  resolveLocalMediaPreviewFromState,
  type MediaPreviewResult,
} from "./media-preview";
import { CSS } from "../constants/css-classes";
import { createChangeChecker } from "../state/change-detection";

type ImagePreviewState =
  | { kind: "image"; src: string }
  | { kind: "pdf-canvas"; path: string }
  | { kind: "loading"; isPdf: boolean }
  | { kind: "error"; fallbackSrc: string };

const imagePreviewHeightCache = new Map<string, number>();

/**
 * Single widget class for all image preview states.
 *
 * Identity includes the preview state so CM6 does not treat a loading widget
 * as equivalent to its later ready/error version and keep stale DOM mounted.
 */
export class ImagePreviewWidget extends ShellWidget {
  private readonly measuredHeightBinding: BlockWidgetHeightBinding = {
    resizeObserver: null,
    resizeMeasureFrame: null,
  };

  constructor(
    readonly alt: string,
    readonly src: string,
    readonly state: ImagePreviewState,
    readonly isBlock = false,
  ) {
    super();
  }

  override updateSourceRange(from: number, to: number): void {
    super.updateSourceRange(from, to);
    if (!this.isBlock) {
      this.shellSurfaceFrom = -1;
      this.shellSurfaceTo = -1;
    }
  }

  private stateKey(): string {
    switch (this.state.kind) {
      case "image":
        return `image:${this.state.src}`;
      case "pdf-canvas":
        return `pdf-canvas:${this.state.path}`;
      case "loading":
        return `loading:${this.state.isPdf ? "pdf" : "image"}`;
      case "error":
        return `error:${this.state.fallbackSrc}`;
    }
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement(this.isBlock ? "div" : "span");
    this.renderInto(wrapper);
    return wrapper;
  }

  private heightBinding(): BlockWidgetHeightBinding {
    return this.measuredHeightBinding;
  }

  private observeMeasuredHeight(
    wrapper: HTMLElement,
    view: EditorView,
  ): void {
    observeBlockWidgetHeight(
      this.heightBinding(),
      wrapper,
      view,
      imagePreviewHeightCache,
      this.src,
    );
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ImagePreviewWidget &&
      this.alt === other.alt &&
      this.src === other.src &&
      this.isBlock === other.isBlock &&
      this.stateKey() === other.stateKey()
    );
  }

  override toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.syncWidgetAttrs(el);
    if (this.isBlock) {
      el.dataset.activeFenceGuides = "true";
      syncActiveFenceGuideClasses(el, view, this.sourceFrom, this.sourceTo);
    } else {
      delete el.dataset.activeFenceGuides;
      clearActiveFenceGuideClasses(el);
    }
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(el, view);
    }
    if (view) {
      this.observeMeasuredHeight(el, view);
    }
    return el;
  }

  updateDOM(dom: HTMLElement, view?: EditorView, from?: WidgetType): boolean {
    const expectedTag = this.isBlock ? "DIV" : "SPAN";
    if (dom.tagName !== expectedTag) return false;
    if (from instanceof ImagePreviewWidget) {
      from.clearMeasuredHeight();
    }
    dom.textContent = "";
    this.renderInto(dom);
    this.syncWidgetAttrs(dom);
    if (this.isBlock) {
      dom.dataset.activeFenceGuides = "true";
      syncActiveFenceGuideClasses(dom, view, this.sourceFrom, this.sourceTo);
    } else {
      delete dom.dataset.activeFenceGuides;
      clearActiveFenceGuideClasses(dom);
    }
    if (view) {
      this.observeMeasuredHeight(dom, view);
    }
    return true;
  }

  private clearMeasuredHeight(): void {
    clearBlockWidgetHeightBinding(this.heightBinding());
  }

  destroy(_dom?: HTMLElement): void {
    this.clearMeasuredHeight();
  }

  get estimatedHeight(): number {
    const cached = estimatedBlockWidgetHeight(imagePreviewHeightCache, this.src);
    if (cached >= 0) return cached;
    return this.state.kind === "loading" ? 100 : -1;
  }

  private renderInto(wrapper: HTMLElement): void {
    switch (this.state.kind) {
      case "image": {
        wrapper.className = CSS.imageWrapper;
        const img = document.createElement("img");
        img.className = CSS.image;
        img.src = this.state.src;
        img.alt = this.alt;
        img.addEventListener("error", () => {
          wrapper.textContent = `[Image: ${this.alt}]`;
          wrapper.className = CSS.imageError;
        });
        wrapper.appendChild(img);
        break;
      }
      case "pdf-canvas": {
        const canvas = getPdfCanvas(this.state.path);
        if (canvas) {
          wrapper.className = CSS.imageWrapper;
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
          wrapper.className = CSS.imageError;
          wrapper.textContent = `[Image: ${this.alt}]`;
        }
        break;
      }
      case "loading":
        wrapper.className = `${CSS.imageWrapper} ${CSS.imageLoading}`;
        wrapper.textContent = this.state.isPdf
          ? `[Loading PDF: ${this.alt || "preview"}]`
          : `[Loading image: ${this.alt || "preview"}]`;
        break;
      case "error": {
        wrapper.className = CSS.imageWrapper;
        const img = document.createElement("img");
        img.className = CSS.image;
        img.src = this.state.fallbackSrc;
        img.alt = this.alt;
        img.addEventListener("error", () => {
          wrapper.textContent = `[Image: ${this.alt}]`;
          wrapper.className = CSS.imageError;
        });
        wrapper.appendChild(img);
        break;
      }
    }
  }
}

function readImageContent(
  state: EditorState,
  node: SyntaxNode,
): { alt: string; src: string } | null {
  const urlNode = node.getChild("URL");
  if (!urlNode) return null;

  const src = state.sliceDoc(urlNode.from, urlNode.to);
  if (!src) return null;

  const marks = node.getChildren("LinkMark");
  const alt = marks.length >= 2
    ? state.sliceDoc(marks[0].to, marks[1].from)
    : "";

  return { alt, src };
}

function mediaPreviewWidget(
  alt: string,
  src: string,
  result: MediaPreviewResult,
  isBlock: boolean,
): RenderWidget {
  switch (result.kind) {
    case "image":
      return new ImagePreviewWidget(alt, src, { kind: "image", src: result.dataUrl }, isBlock);
    case "pdf-canvas":
      return new ImagePreviewWidget(alt, src, { kind: "pdf-canvas", path: result.resolvedPath }, isBlock);
    case "loading":
      return new ImagePreviewWidget(alt, src, { kind: "loading", isPdf: result.isPdf }, isBlock);
    case "error":
      return new ImagePreviewWidget(alt, src, { kind: "error", fallbackSrc: result.fallbackSrc }, isBlock);
  }
}

function isStandaloneImageLine(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const line = state.doc.lineAt(from);
  const imageText = state.sliceDoc(from, to);
  return line.text.trim() === imageText;
}

function buildImageDecorations(state: EditorState): DecorationSet {
  const items: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Image") return;
      const parsed = readImageContent(state, node.node);
      if (!parsed) return false;

      const isBlock = isStandaloneImageLine(state, node.from, node.to);
      const preview = resolveLocalMediaPreviewFromState(state, parsed.src);
      const widget = preview
        ? mediaPreviewWidget(parsed.alt, parsed.src, preview, isBlock)
        : new ImagePreviewWidget(
            parsed.alt,
            parsed.src,
            { kind: "image", src: parsed.src },
            isBlock,
          );
      if (isBlock) {
        pushBlockWidgetDecoration(items, widget, node.from, node.to);
      } else {
        pushWidgetDecoration(items, widget, node.from, node.to);
      }
      return false;
    },
  });
  return buildDecorations(items);
}

const imageDecorationsChanged = createChangeChecker(
  { doc: true, tree: true },
  (state) => state.field(pdfPreviewField, false),
  (state) => state.field(imageUrlField, false),
);

const imageDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildImageDecorations(state);
  },
  update(value, tr) {
    return imageDecorationsChanged(tr) ? buildImageDecorations(tr.state) : value;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

function requestImagePreviews(view: EditorView): void {
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== "Image") return;
      const parsed = readImageContent(view.state, node.node);
      if (!parsed) return false;
      resolveLocalMediaPreview(view, parsed.src);
      return false;
    },
  });
}

const imageRequestPlugin = ViewPlugin.fromClass(class {
  constructor(view: EditorView) {
    requestImagePreviews(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      requestImagePreviews(update.view);
    }
  }
});

export { imageDecorationField as _imageDecorationFieldForTest };

export const imageRenderPlugin: Extension = [
  imageDecorationField,
  imageRequestPlugin,
];
