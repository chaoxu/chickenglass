/**
 * Right-margin filename decoration for include regions.
 * Uses a StateField for Decoration.line (required by CM6) and
 * a ViewPlugin for the widget.
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
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
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

// ── StateField: Decoration.line for cg-include-region class ──────────────────

function buildLineDecorations(state: EditorState): DecorationSet {
  const sourceMap = getSourceMap();
  if (!sourceMap || sourceMap.regions.length === 0) return Decoration.none;

  const items: Range<Decoration>[] = [];
  for (const region of sourceMap.regions) {
    const from = Math.min(region.from, state.doc.length);
    const to = Math.min(region.to, state.doc.length);
    if (from >= to) continue;
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);
    for (let ln = startLine.number; ln <= endLine.number; ln++) {
      items.push(Decoration.line({ class: "cg-include-region" }).range(state.doc.line(ln).from));
    }
  }
  return buildDecorations(items);
}

const includeLabelLineField = StateField.define<DecorationSet>({
  create(state) { return buildLineDecorations(state); },
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildLineDecorations(tr.state);
    return value;
  },
  provide(field) { return EditorView.decorations.from(field); },
});

// ── ViewPlugin: widget label at start of each region ─────────────────────────

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
    for (const region of sourceMap.regions) {
      const from = Math.min(region.from, doc.length);
      const to = Math.min(region.to, doc.length);
      if (from >= to) continue;
      const active = cursor >= from && cursor <= to;
      const filename = region.file.split("/").pop() ?? region.file;
      const line = doc.lineAt(from);
      items.push(Decoration.widget({ widget: new IncludeLabelWidget(filename, active), side: 1 }).range(line.from));
    }
    return buildDecorations(items);
  }
}

const includeLabelWidgetPlugin = ViewPlugin.fromClass(IncludeLabelPlugin, {
  decorations: (v) => v.decorations,
});

/** CM6 extension that renders include region labels in the right margin. */
export const includeLabelPlugin: Extension = [includeLabelLineField, includeLabelWidgetPlugin];
