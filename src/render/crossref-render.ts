/**
 * CM6 ViewPlugin for rendering cross-references.
 *
 * Finds [@id] and @id patterns in the document, resolves them using
 * the crossref-resolver, and renders them as styled inline text
 * with Typora-style toggle (rendered by default, source on focus).
 */

import {
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  Decoration,
  type EditorView,
} from "@codemirror/view";
import { type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  type ResolvedCrossref,
  type EquationEntry,
  findCrossrefs,
  resolveCrossref,
  collectEquationLabels,
} from "../index/crossref-resolver";
import { buildDecorations, cursorInRange, RenderWidget } from "./render-utils";

/** Widget for a resolved cross-reference (block or equation). */
export class CrossrefWidget extends RenderWidget {
  constructor(
    private readonly resolved: ResolvedCrossref,
    private readonly raw: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cg-crossref";
    span.textContent = this.resolved.label;
    span.title = this.raw;
    return span;
  }

  eq(other: CrossrefWidget): boolean {
    return (
      this.resolved.kind === other.resolved.kind &&
      this.resolved.label === other.resolved.label &&
      this.raw === other.raw
    );
  }
}

/** Widget for an unresolved cross-reference. */
export class UnresolvedRefWidget extends RenderWidget {
  constructor(private readonly raw: string) {
    super();
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cg-crossref cg-crossref-unresolved";
    span.textContent = this.raw;
    span.title = "Unresolved reference";
    return span;
  }

  eq(other: UnresolvedRefWidget): boolean {
    return this.raw === other.raw;
  }
}

/** Collect decoration ranges for cross-references outside the cursor. */
export function collectCrossrefRanges(view: EditorView): Range<Decoration>[] {
  const refs = findCrossrefs(view.state);
  const items: Range<Decoration>[] = [];
  // Precompute equation labels once for all references
  const equationLabels: ReadonlyMap<string, EquationEntry> =
    collectEquationLabels(view.state);

  for (const ref of refs) {
    if (cursorInRange(view, ref.from, ref.to)) continue;

    const raw = view.state.sliceDoc(ref.from, ref.to);
    const resolved = resolveCrossref(view.state, ref.id, equationLabels);

    // Skip citations — let the citation render plugin handle them
    if (resolved.kind === "citation") continue;

    let widget: RenderWidget;
    if (resolved.kind === "block" || resolved.kind === "equation") {
      widget = new CrossrefWidget(resolved, raw);
    } else {
      widget = new UnresolvedRefWidget(raw);
    }
    widget.sourceFrom = ref.from;
    items.push(
      Decoration.replace({ widget }).range(ref.from, ref.to),
    );
  }

  return items;
}

class CrossrefRenderPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(collectCrossrefRanges(view));
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.decorations = buildDecorations(collectCrossrefRanges(update.view));
    }
  }
}

/** CM6 extension that renders cross-references with Typora-style toggle. */
export const crossrefRenderPlugin: Extension = ViewPlugin.fromClass(
  CrossrefRenderPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
