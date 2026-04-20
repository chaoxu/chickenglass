import type { EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import type {
  PluginRenderAdapter,
  PluginRenderWidget,
} from "../plugins/plugin-render-adapter";
import {
  ShellMacroAwareWidget,
} from "./render-core";

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
};
