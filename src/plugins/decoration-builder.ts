import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import type { FencedDivInfo } from "../fenced-block/model";
import { pluginRenderAdapter } from "../lib/plugin-render-adapter";
import { decorationHidden } from "../render/render-core";
import type { PluginRenderAdapter } from "./plugin-render-adapter";
import {
  addAttributeTitleDecoration,
  addHeaderWidgetDecoration,
  addInlineTitleParenDecorations,
} from "../render/plugin-adapters/chrome";
import { addEmbedWidget } from "../render/plugin-adapters/embed";

/**
 * Fluent helper for accumulating block-render decorations while keeping the
 * underlying push order stable.
 */
export class DecorationBuilder {
  constructor(
    private readonly items: Range<Decoration>[] = [],
    private readonly adapter: PluginRenderAdapter = pluginRenderAdapter,
  ) {}

  addHidden(from?: number, to?: number): this {
    if (from === undefined || to === undefined || to <= from) {
      return this;
    }
    this.items.push(decorationHidden.range(from, to));
    return this;
  }

  addLine(at: number, className: string): this {
    if (!className) return this;
    this.items.push(Decoration.line({ class: className }).range(at));
    return this;
  }

  addIncludeDecorations(div: FencedDivInfo): this {
    this
      .addHidden(div.openFenceFrom, div.openFenceTo)
      .addHidden(div.attrFrom, div.attrTo)
      .addHidden(div.titleFrom, div.titleTo);

    if (div.closeFenceFrom >= 0 && div.closeFenceTo > div.closeFenceFrom) {
      this.addHidden(div.closeFenceFrom, div.closeFenceTo);
    }

    this.addLine(div.openFenceFrom, CSS.includeFence);
    if (div.closeFenceFrom >= 0) {
      this.addLine(div.closeFenceFrom, CSS.includeFence);
    }

    return this;
  }

  addHeaderWidget(
    div: FencedDivInfo,
    header: string,
    cursorInside: boolean,
    macros: Record<string, string>,
  ): this {
    addHeaderWidgetDecoration(this.adapter, div, header, cursorInside, macros, this.items);
    return this;
  }

  addInlineTitleParens(titleFrom?: number, titleTo?: number): this {
    if (titleFrom === undefined || titleTo === undefined) {
      return this;
    }
    addInlineTitleParenDecorations(titleFrom, titleTo, this.items);
    return this;
  }

  addAttributeTitle(
    openFenceTo: number,
    title: string | undefined,
    macros: Record<string, string>,
  ): this {
    if (!title) return this;
    addAttributeTitleDecoration(openFenceTo, title, macros, this.items);
    return this;
  }

  addEmbedWidget(
    state: EditorState,
    div: FencedDivInfo,
    active: boolean,
  ): this {
    addEmbedWidget(this.adapter, state, div, this.items, active);
    return this;
  }

  addQedDecoration(state: EditorState, div: FencedDivInfo): this {
    if (div.closeFenceFrom < 0) return this;

    const closeLine = state.doc.lineAt(div.closeFenceFrom);
    if (closeLine.number <= 1) return this;

    const lastContentLine = state.doc.line(closeLine.number - 1);
    if (lastContentLine.from <= div.openFenceFrom) return this;

    this.addLine(lastContentLine.from, CSS.blockQed);
    return this;
  }

  build(): readonly Range<Decoration>[] {
    return this.items;
  }
}
