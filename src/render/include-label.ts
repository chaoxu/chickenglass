/**
 * Right-margin filename decoration for include regions.
 *
 * Renders a rotated filename label on the right margin for each include
 * region, indicating which included file a section of the document
 * belongs to. The label has low opacity normally and becomes brighter
 * when the cursor is within the region.
 *
 * The source map is read from `window.__cgSourceMap`, set by the App
 * class after building the source map in `openFile()`.
 */

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { type Extension, type Range } from "@codemirror/state";

/** A region of the document that came from an included file. */
export interface IncludeRegion {
  /** Start offset in the document. */
  from: number;
  /** End offset in the document. */
  to: number;
  /** Filename of the included file. */
  file: string;
}

/** Maps document positions to their source files. */
export interface SourceMap {
  regions: IncludeRegion[];
}

/** Widget that renders a rotated filename label in the right margin. */
class IncludeLabelWidget extends WidgetType {
  constructor(
    private readonly filename: string,
    private readonly active: boolean,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.active
      ? "cg-include-label cg-include-label-active"
      : "cg-include-label";
    span.textContent = this.filename;
    return span;
  }

  eq(other: IncludeLabelWidget): boolean {
    return this.filename === other.filename && this.active === other.active;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Read the source map from the global set by App. */
function getSourceMap(): SourceMap | null {
  const global = window as unknown as { __cgSourceMap?: SourceMap };
  return global.__cgSourceMap ?? null;
}

class IncludeLabelPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet
    ) {
      this.decorations = this.build(update.view);
    }
  }

  private build(view: EditorView): DecorationSet {
    const sourceMap = getSourceMap();
    if (!sourceMap || sourceMap.regions.length === 0) {
      return Decoration.none;
    }

    const decorations: Range<Decoration>[] = [];
    const cursor = view.state.selection.main.head;
    const doc = view.state.doc;

    for (const region of sourceMap.regions) {
      // Clamp region bounds to document length
      const from = Math.min(region.from, doc.length);
      const to = Math.min(region.to, doc.length);
      if (from >= to) continue;

      const active = cursor >= from && cursor <= to;

      // Add widget decoration at the start of the region's first line
      const startLine = doc.lineAt(from);
      const filename = region.file.split("/").pop() ?? region.file;
      decorations.push(
        Decoration.widget({
          widget: new IncludeLabelWidget(filename, active),
          side: 1,
        }).range(startLine.from),
      );

      // Add line decorations for all lines in the region
      const endLine = doc.lineAt(to);
      for (
        let lineNum = startLine.number;
        lineNum <= endLine.number;
        lineNum++
      ) {
        const line = doc.line(lineNum);
        decorations.push(
          Decoration.line({ class: "cg-include-region" }).range(line.from),
        );
      }
    }

    // Sort by position for CM6
    decorations.sort((a, b) => a.from - b.from);

    return Decoration.set(decorations);
  }
}

/** CM6 extension that renders include region labels in the right margin. */
export const includeLabelPlugin: Extension = ViewPlugin.fromClass(
  IncludeLabelPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
