import { type Range } from "@codemirror/state";
import {
  Decoration,
  WidgetType,
} from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import type { FencedDivInfo } from "../fenced-block/model";
import {
  getFencedDivRevealFrom,
  getFencedDivRevealTo,
  getFencedDivStructuralOpenTo,
} from "../fenced-block/model";
import {
  addPluginMarkerReplacement,
  type PluginRenderAdapter,
} from "./plugin-render-adapter";

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
  adapter: PluginRenderAdapter,
  openFenceTo: number,
  title: string,
  macros: Record<string, string>,
  items: Range<Decoration>[],
): void {
  items.push(
    Decoration.widget({
      widget: adapter.createAttributeTitleWidget(title, macros),
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
