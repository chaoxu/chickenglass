import { type Range } from "@codemirror/state";
import {
  Decoration,
  WidgetType,
} from "@codemirror/view";
import { CSS } from "../../constants/css-classes";
import { renderDocumentFragmentToDom } from "../../document-surfaces";
import type { FencedDivInfo } from "../../fenced-block/model";
import {
  getFencedDivRevealFrom,
  getFencedDivRevealTo,
  getFencedDivStructuralOpenTo,
} from "../../fenced-block/model";
import { ShellMacroAwareWidget } from "../shell-widget";
import { syncActiveFenceGuideClasses } from "../source-widget";
import {
  addPluginMarkerReplacement,
  type PluginRenderAdapter,
} from "../../plugins/plugin-render-adapter";

class SimpleTextWidget extends WidgetType {
  constructor(
    private readonly tagName: string,
    private readonly className: string,
    private readonly text: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement(this.tagName);
    el.className = this.className;
    el.textContent = this.text;
    return el;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof SimpleTextWidget &&
      this.tagName === other.tagName &&
      this.className === other.className &&
      this.text === other.text
    );
  }
}

function createSimpleTextWidget(
  tagName: string,
  className: string,
  text: string,
): WidgetType {
  return new SimpleTextWidget(tagName, className, text);
}

const openParenWidget = Decoration.widget({
  widget: createSimpleTextWidget("span", CSS.blockTitleParen, "("),
  side: -1,
});

const closeParenWidget = Decoration.widget({
  widget: createSimpleTextWidget("span", CSS.blockTitleParen, ")"),
  side: 1,
});

function captionClassName(active: boolean): string {
  return active
    ? `cf-block-caption ${CSS.activeShellWidget} ${CSS.activeShellFooter}`
    : "cf-block-caption";
}

abstract class MacroRenderingWidget extends ShellMacroAwareWidget {
  protected readonly macros: Record<string, string>;

  constructor(macros: Record<string, string>) {
    super(macros);
    this.macros = macros;
    this.useLiveSourceRange = false;
  }

  protected createRenderedDOM(build: () => HTMLElement): HTMLElement {
    return this.createCachedDOM(build);
  }

  protected refreshRenderedDOM(
    dom: HTMLElement,
    render: (el: HTMLElement) => void,
  ): boolean {
    render(dom);
    this.syncWidgetAttrs(dom);
    return true;
  }

  protected renderBlockTitle(el: HTMLElement, text: string): void {
    el.textContent = "";
    renderDocumentFragmentToDom(el, {
      kind: "block-title",
      text,
      macros: this.macros,
    });
  }
}

export class BlockHeaderWidget extends MacroRenderingWidget {
  constructor(
    private readonly header: string,
    macros: Record<string, string>,
  ) {
    super(macros);
  }

  createDOM(): HTMLElement {
    return this.createRenderedDOM(() => {
      const el = document.createElement("span");
      el.className = CSS.blockHeaderRendered;
      this.renderBlockTitle(el, this.header);
      return el;
    });
  }

  eq(other: BlockHeaderWidget): boolean {
    return this.header === other.header && this.macrosKey === other.macrosKey;
  }

  updateDOM(dom: HTMLElement): boolean {
    return this.refreshRenderedDOM(dom, (el) => {
      el.className = CSS.blockHeaderRendered;
      this.renderBlockTitle(el, this.header);
    });
  }
}

export class BlockCaptionWidget extends MacroRenderingWidget {
  constructor(
    private readonly header: string,
    private readonly title: string,
    macros: Record<string, string>,
    private readonly active: boolean = false,
  ) {
    super(macros);
  }

  private renderCaptionContent(el: HTMLElement): void {
    el.textContent = "";

    const headerEl = document.createElement("span");
    headerEl.className = CSS.blockHeaderRendered;
    this.renderBlockTitle(headerEl, this.header);
    el.appendChild(headerEl);

    if (!this.title) return;

    const titleEl = document.createElement("span");
    titleEl.className = "cf-block-caption-text";
    this.renderBlockTitle(titleEl, this.title);
    el.appendChild(titleEl);
  }

  createDOM(): HTMLElement {
    return this.createRenderedDOM(() => {
      const el = document.createElement("div");
      el.className = captionClassName(this.active);
      this.renderCaptionContent(el);
      return el;
    });
  }

  override toDOM(view?: import("@codemirror/view").EditorView): HTMLElement {
    const el = this.createDOM();
    this.syncWidgetAttrs(el);
    el.dataset.activeFenceGuides = "true";
    syncActiveFenceGuideClasses(el, view, this.sourceFrom, this.sourceTo);
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

  updateDOM(
    dom: HTMLElement,
    view?: import("@codemirror/view").EditorView,
  ): boolean {
    if (!dom.classList.contains("cf-block-caption")) return false;
    this.refreshRenderedDOM(dom, (el) => {
      el.className = captionClassName(this.active);
      this.renderCaptionContent(el);
    });
    dom.dataset.activeFenceGuides = "true";
    syncActiveFenceGuideClasses(dom, view, this.sourceFrom, this.sourceTo);
    return true;
  }
}

class AttributeTitleWidget extends MacroRenderingWidget {
  constructor(
    private readonly title: string,
    macros: Record<string, string>,
  ) {
    super(macros);
  }

  private renderAttributeTitle(el: HTMLElement): void {
    el.className = CSS.blockAttrTitle;
    el.textContent = "";

    const openParen = document.createElement("span");
    openParen.className = CSS.blockTitleParen;
    openParen.textContent = "(";
    el.appendChild(openParen);

    const titleContent = document.createElement("span");
    this.renderBlockTitle(titleContent, this.title);
    el.appendChild(titleContent);

    const closeParen = document.createElement("span");
    closeParen.className = CSS.blockTitleParen;
    closeParen.textContent = ")";
    el.appendChild(closeParen);
  }

  createDOM(): HTMLElement {
    return this.createRenderedDOM(() => {
      const el = document.createElement("span");
      this.renderAttributeTitle(el);
      return el;
    });
  }

  eq(other: AttributeTitleWidget): boolean {
    return this.title === other.title && this.macrosKey === other.macrosKey;
  }

  updateDOM(dom: HTMLElement): boolean {
    if (!dom.classList.contains(CSS.blockAttrTitle)) return false;
    return this.refreshRenderedDOM(dom, (el) => {
      this.renderAttributeTitle(el);
    });
  }
}
/**
 * Add header widget decoration using the heading-like marker replacement pattern.
 *
 * CRITICAL: The widget replaces ONLY the fence prefix ("::: {.class}"), NOT the
 * title text. Title text stays as editable content where inline plugins (math,
 * bold, etc.) render naturally.
 */
export function addHeaderWidgetDecoration(
  adapter: PluginRenderAdapter,
  div: FencedDivInfo,
  header: string,
  cursorInside: boolean,
  macros: Record<string, string>,
  items: Range<Decoration>[],
): void {
  const replaceEnd = getFencedDivStructuralOpenTo(div);
  const widget = header ? adapter.createHeaderWidget(header, macros) : null;
  addPluginMarkerReplacement(div.openFenceFrom, replaceEnd, cursorInside, widget, items);
}

export function addInlineTitleParenDecorations(
  titleFrom: number,
  titleTo: number,
  items: Range<Decoration>[],
): void {
  items.push(openParenWidget.range(titleFrom));
  items.push(closeParenWidget.range(titleTo));
}

export function addAttributeTitleDecoration(
  openFenceTo: number,
  title: string,
  macros: Record<string, string>,
  items: Range<Decoration>[],
): void {
  items.push(
    Decoration.widget({
      widget: new AttributeTitleWidget(title, macros),
      side: 1,
    }).range(openFenceTo),
  );
}

export function addInlineHeaderDecoration(
  adapter: PluginRenderAdapter,
  div: FencedDivInfo,
  firstBodyLineFrom: number,
  header: string,
  className: string,
  macros: Record<string, string>,
  items: Range<Decoration>[],
): void {
  const inlineHeaderWidget = adapter.createHeaderWidget(header, macros);
  inlineHeaderWidget.updateSourceRange(
    getFencedDivRevealFrom(div),
    getFencedDivRevealTo(div),
  );
  items.push(
    Decoration.line({ class: `${className} ${CSS.blockHeader}` }).range(firstBodyLineFrom),
  );
  items.push(
    Decoration.widget({
      widget: inlineHeaderWidget,
      side: -1,
    }).range(firstBodyLineFrom),
  );
}

export function addCaptionDecoration(
  adapter: PluginRenderAdapter,
  div: FencedDivInfo,
  lastBodyLineTo: number,
  header: string,
  title: string,
  macros: Record<string, string>,
  active: boolean,
  items: Range<Decoration>[],
): void {
  const captionWidget = adapter.createCaptionWidget(header, title, macros, active);
  captionWidget.updateSourceRange(
    div.titleFrom ?? getFencedDivRevealFrom(div),
    div.titleTo ?? getFencedDivRevealTo(div),
  );
  items.push(
    Decoration.widget({
      widget: captionWidget,
      side: 1,
      block: true,
    }).range(lastBodyLineTo),
  );
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
