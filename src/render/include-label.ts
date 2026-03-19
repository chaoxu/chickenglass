/**
 * Right-margin filename decoration for include regions.
 * Single ViewPlugin computes both line decorations and widget labels in one pass.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { type Extension, type Range } from "@codemirror/state";
import { buildDecorations } from "./render-utils";

/** A region of the document that came from an included file. */
export interface IncludeRegion {
  from: number;
  to: number;
  file: string;
}

/** Maps document positions to their source files. */
export interface SourceMap {
  regions: IncludeRegion[];
}

function getSourceMap(): SourceMap | null {
  return (window as unknown as { __cgSourceMap?: SourceMap }).__cgSourceMap ?? null;
}

class IncludeLabelWidget extends WidgetType {
  constructor(private readonly filename: string, private readonly active: boolean) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.active ? "cg-include-label cg-include-label-active" : "cg-include-label";
    span.textContent = this.filename;
    return span;
  }
  eq(other: IncludeLabelWidget): boolean {
    return this.filename === other.filename && this.active === other.active;
  }
  ignoreEvent(): boolean { return true; }
}

class IncludeLabelPlugin implements PluginValue {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.build(update.view);
    }
  }
  private build(view: EditorView): DecorationSet {
    const sourceMap = getSourceMap();
    if (!sourceMap || sourceMap.regions.length === 0) return Decoration.none;

    const items: Range<Decoration>[] = [];
    const cursor = view.state.selection.main.head;
    const doc = view.state.doc;
    const lineDeco = Decoration.line({ class: "cg-include-region" });

    for (const region of sourceMap.regions) {
      const from = Math.min(region.from, doc.length);
      const to = Math.min(region.to, doc.length);
      if (from >= to) continue;

      // Widget label at start of region
      const active = cursor >= from && cursor <= to;
      const filename = region.file.split("/").pop() ?? region.file;
      const startLine = doc.lineAt(from);
      items.push(Decoration.widget({ widget: new IncludeLabelWidget(filename, active), side: 1 }).range(startLine.from));

      // Line decorations for every line in the region
      const endLine = doc.lineAt(to);
      for (let ln = startLine.number; ln <= endLine.number; ln++) {
        items.push(lineDeco.range(doc.line(ln).from));
      }
    }
    return buildDecorations(items);
  }
}

/** CM6 extension that renders include region labels in the right margin. */
export const includeLabelPlugin: Extension = ViewPlugin.fromClass(IncludeLabelPlugin, {
  decorations: (v) => v.decorations,
});
