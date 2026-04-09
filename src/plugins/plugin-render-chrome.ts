import { type Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import type { FencedDivInfo } from "../fenced-block/model";
import {
  getFencedDivRevealFrom,
  getFencedDivRevealTo,
  getFencedDivStructuralOpenTo,
} from "../fenced-block/model";
import {
  addMarkerReplacement,
  createSimpleTextWidget,
  ShellMacroAwareWidget,
} from "../render/render-core";

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

/** Widget that renders a block header string with inline math/bold/italic. */
export class BlockHeaderWidget extends ShellMacroAwareWidget {
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
    // Refresh source-range metadata so search-highlight reads correct positions
    this.setSourceRangeAttrs(dom);
    return true;
  }
}

export class BlockCaptionWidget extends ShellMacroAwareWidget {
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

  eq(other: BlockCaptionWidget): boolean {
    return (
      this.header === other.header &&
      this.title === other.title &&
      this.macrosKey === other.macrosKey &&
      this.active === other.active
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    if (!dom.classList.contains("cf-block-caption")) return false;
    dom.className = captionClassName(this.active);
    this.renderCaptionContent(dom);
    this.setSourceRangeAttrs(dom);
    return true;
  }
}

/**
 * Widget that renders an attribute-only title (title="..." in the attributes,
 * no inline title text in the document).
 *
 * Unlike inline titles that stay as editable document content, attribute titles
 * live inside the attribute string and have no document range. They are rendered
 * as a widget with parentheses, matching how inline titles appear visually.
 * Inline formatting (bold, math, etc.) is supported via renderDocumentFragmentToDom.
 */
class AttributeTitleWidget extends ShellMacroAwareWidget {
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

/**
 * Add header widget decoration using the heading-like marker replacement pattern.
 *
 * CRITICAL: The widget replaces ONLY the fence prefix ("::: {.class}"), NOT the
 * title text. Title text stays as editable content where inline plugins (math,
 * bold, etc.) render naturally. See addMarkerReplacement() and CLAUDE.md
 * "Block headers must behave like headings."
 *
 * DO NOT change replaceEnd to titleTo — this kills inline rendering and has
 * regressed 3+ times.
 */
export function addHeaderWidgetDecoration(
  div: FencedDivInfo,
  header: string,
  cursorInside: boolean,
  macros: Record<string, string>,
  items: Range<Decoration>[],
): void {
  // Replace only the fence prefix, leave title text as editable content.
  // No-title case: replaceEnd = openFenceTo (whole fence line, nothing to split).
  // With-title case: replaceEnd = titleFrom (stop before title text).
  const replaceEnd = getFencedDivStructuralOpenTo(div);
  const widget = header ? new BlockHeaderWidget(header, macros) : null;
  addMarkerReplacement(div.openFenceFrom, replaceEnd, cursorInside, widget, items);
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
  div: FencedDivInfo,
  firstBodyLineFrom: number,
  header: string,
  className: string,
  macros: Record<string, string>,
  items: Range<Decoration>[],
): void {
  const inlineHeaderWidget = new BlockHeaderWidget(header, macros);
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
  div: FencedDivInfo,
  lastBodyLineTo: number,
  header: string,
  title: string,
  macros: Record<string, string>,
  active: boolean,
  items: Range<Decoration>[],
): void {
  const captionWidget = new BlockCaptionWidget(header, title, macros, active);
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
