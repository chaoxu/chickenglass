import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import type { FencedDivInfo } from "../fenced-block/model";
import { pushPluginHiddenDecoration } from "./plugin-render-adapter";

/**
 * Fluent helper for accumulating block-render decorations while keeping the
 * underlying push order stable.
 */
export class DecorationBuilder {
  constructor(private readonly items: Range<Decoration>[] = []) {}

  addHidden(from?: number, to?: number): this {
    if (from === undefined || to === undefined || to <= from) {
      return this;
    }
    pushPluginHiddenDecoration(this.items, from, to);
    return this;
  }

  addLine(at: number, className: string): this {
    if (!className) return this;
    this.items.push(Decoration.line({ class: className }).range(at));
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
