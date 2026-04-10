import type { EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { IFRAME_MAX_ATTEMPTS, IFRAME_POLL_INTERVAL_MS } from "../constants/timing";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import type {
  PluginRenderAdapter,
  PluginRenderWidget,
} from "../plugins/plugin-render-adapter";
import {
  ShellMacroAwareWidget,
  ShellWidget,
} from "./render-core";
import { mutateWithScrollStabilizedMeasure } from "./scroll-anchor";

function captionClassName(active: boolean): string {
  return active
    ? `cf-block-caption ${CSS.activeShellWidget} ${CSS.activeShellFooter}`
    : "cf-block-caption";
}

export class BlockHeaderWidget extends ShellMacroAwareWidget implements PluginRenderWidget {
  constructor(
    private readonly header: string,
    private readonly macros: Record<string, string>,
  ) {
    super(macros);
    this.useLiveSourceRange = false;
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("span");
      el.className = CSS.blockHeaderRendered;
      renderDocumentFragmentToDom(el, {
        kind: "block-title",
        text: this.header,
        macros: this.macros,
      });
      return el;
    });
  }

  eq(other: BlockHeaderWidget): boolean {
    return this.header === other.header && this.macrosKey === other.macrosKey;
  }

  updateDOM(dom: HTMLElement): boolean {
    dom.textContent = "";
    renderDocumentFragmentToDom(dom, {
      kind: "block-title",
      text: this.header,
      macros: this.macros,
    });
    this.setSourceRangeAttrs(dom);
    return true;
  }
}

export class BlockCaptionWidget extends ShellMacroAwareWidget implements PluginRenderWidget {
  constructor(
    private readonly header: string,
    private readonly title: string,
    private readonly macros: Record<string, string>,
    private readonly active: boolean = false,
  ) {
    super(macros);
    this.useLiveSourceRange = false;
  }

  private renderCaptionContent(el: HTMLElement): void {
    el.textContent = "";

    const headerEl = document.createElement("span");
    headerEl.className = CSS.blockHeaderRendered;
    renderDocumentFragmentToDom(headerEl, {
      kind: "block-title",
      text: this.header,
      macros: this.macros,
    });
    el.appendChild(headerEl);

    if (!this.title) return;

    const titleEl = document.createElement("span");
    titleEl.className = "cf-block-caption-text";
    renderDocumentFragmentToDom(titleEl, {
      kind: "block-title",
      text: this.title,
      macros: this.macros,
    });
    el.appendChild(titleEl);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("div");
      el.className = captionClassName(this.active);
      this.renderCaptionContent(el);
      return el;
    });
  }

  override toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.syncWidgetAttrs(el);
    this.syncFenceGuideOptIn(el, true, view);
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(el, view);
    }
    return el;
  }

  eq(other: BlockCaptionWidget): boolean {
    return (
      this.header === other.header &&
      this.title === other.title &&
      this.macrosKey === other.macrosKey &&
      this.active === other.active
    );
  }

  updateDOM(dom: HTMLElement, view?: EditorView): boolean {
    if (!dom.classList.contains("cf-block-caption")) return false;
    dom.className = captionClassName(this.active);
    this.renderCaptionContent(dom);
    this.syncWidgetAttrs(dom);
    this.syncFenceGuideOptIn(dom, true, view);
    return true;
  }
}

class AttributeTitleWidget extends ShellMacroAwareWidget implements PluginRenderWidget {
  constructor(
    private readonly title: string,
    private readonly macros: Record<string, string>,
  ) {
    super(macros);
    this.useLiveSourceRange = false;
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("span");
      el.className = CSS.blockAttrTitle;

      const openParen = document.createElement("span");
      openParen.className = CSS.blockTitleParen;
      openParen.textContent = "(";
      el.appendChild(openParen);

      const titleContent = document.createElement("span");
      renderDocumentFragmentToDom(titleContent, {
        kind: "block-title",
        text: this.title,
        macros: this.macros,
      });
      el.appendChild(titleContent);

      const closeParen = document.createElement("span");
      closeParen.className = CSS.blockTitleParen;
      closeParen.textContent = ")";
      el.appendChild(closeParen);

      return el;
    });
  }

  eq(other: AttributeTitleWidget): boolean {
    return this.title === other.title && this.macrosKey === other.macrosKey;
  }
}

function tryResizeIframe(
  iframe: HTMLIFrameElement,
  view?: EditorView,
): "resized" | "unavailable" | "blocked" {
  try {
    const doc = iframe.contentDocument;
    if (doc?.body) {
      const height = doc.body.scrollHeight;
      if (height > 0) {
        const nextHeight = `${height}px`;
        if (iframe.style.height !== nextHeight) {
          mutateWithScrollStabilizedMeasure(view, () => {
            iframe.style.height = nextHeight;
          });
        }
        return "resized";
      }
    }
    return "unavailable";
  } catch (_error) {
    return "blocked";
  }
}

function autoResizeGistIframe(
  iframe: HTMLIFrameElement,
  view?: EditorView,
): () => void {
  const result = tryResizeIframe(iframe, view);
  if (result !== "unavailable") {
    return () => {};
  }

  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const poll = (): void => {
    if (cancelled) return;
    attempts++;
    const result = tryResizeIframe(iframe, view);
    if (result === "unavailable" && attempts < IFRAME_MAX_ATTEMPTS) {
      timer = setTimeout(poll, IFRAME_POLL_INTERVAL_MS);
    } else {
      timer = null;
    }
  };

  timer = setTimeout(poll, IFRAME_POLL_INTERVAL_MS);
  return () => {
    cancelled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function embedSandboxPermissions(embedType: string): string {
  if (embedType === "youtube") {
    return "allow-scripts allow-presentation";
  }
  return "allow-scripts";
}

class EmbedWidget extends ShellWidget implements PluginRenderWidget {
  private readonly gistCleanup = new WeakMap<
    HTMLElement,
    {
      readonly iframe: HTMLIFrameElement;
      readonly handleLoad: () => void;
      readonly cancelResize: () => void;
    }
  >();

  constructor(
    private readonly src: string,
    private readonly embedType: string,
    private readonly active: boolean = false,
  ) {
    super();
    this.useLiveSourceRange = false;
  }

  private attachGistResize(
    wrapper: HTMLElement,
    iframe: HTMLIFrameElement,
    view?: EditorView,
  ): void {
    let cancelResize = () => {};
    const handleLoad = (): void => {
      cancelResize();
      cancelResize = autoResizeGistIframe(iframe, view);
    };
    iframe.addEventListener("load", handleLoad, { once: true });
    this.gistCleanup.set(wrapper, {
      iframe,
      handleLoad,
      cancelResize: () => {
        cancelResize();
      },
    });
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = this.active
      ? `${CSS.embed(this.embedType)} ${CSS.activeShellWidget}`
      : CSS.embed(this.embedType);

    const iframe = document.createElement("iframe");
    iframe.src = this.src;
    iframe.setAttribute("sandbox", embedSandboxPermissions(this.embedType));
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("frameborder", "0");

    if (this.embedType === "youtube") {
      iframe.setAttribute("allowfullscreen", "");
      iframe.className = CSS.embedYoutubeIframe;
    } else {
      iframe.className = CSS.embedIframe;
    }

    wrapper.appendChild(iframe);
    return wrapper;
  }

  override toDOM(view?: EditorView): HTMLElement {
    const wrapper = this.createDOM();
    this.syncWidgetAttrs(wrapper);
    this.syncFenceGuideOptIn(wrapper, true, view);
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(wrapper, view);
    }

    if (this.embedType === "gist") {
      const iframe = wrapper.querySelector("iframe");
      if (iframe instanceof HTMLIFrameElement) {
        this.attachGistResize(wrapper, iframe, view);
      }
    }

    return wrapper;
  }

  override destroy(dom: HTMLElement): void {
    const cleanup = this.gistCleanup.get(dom);
    if (!cleanup) return;
    cleanup.iframe.removeEventListener("load", cleanup.handleLoad);
    cleanup.cancelResize();
    this.gistCleanup.delete(dom);
  }

  protected override bindSourceReveal(
    _el: HTMLElement,
    _view: EditorView,
  ): void {
    // Embed previews remain interactive in stable-shell mode.
  }

  eq(other: EmbedWidget): boolean {
    return (
      this.src === other.src &&
      this.embedType === other.embedType &&
      this.active === other.active
    );
  }
}

export const codeMirrorPluginRenderAdapter: PluginRenderAdapter = {
  createHeaderWidget(header, macros) {
    return new BlockHeaderWidget(header, macros);
  },
  createCaptionWidget(header, title, macros, active) {
    return new BlockCaptionWidget(header, title, macros, active);
  },
  createAttributeTitleWidget(title, macros) {
    return new AttributeTitleWidget(title, macros);
  },
  createEmbedWidget(src, embedType, active) {
    return new EmbedWidget(src, embedType, active);
  },
};
