/**
 * Cross-reference widget classes and collection helper.
 *
 * The ViewPlugin that used these has been merged into the unified
 * `referenceRenderPlugin` in `./reference-render.ts`. This module
 * still exports widget classes and `collectCrossrefRanges` for
 * tests and other consumers (e.g., hover-preview).
 */

import {
  Decoration,
  type EditorView,
} from "@codemirror/view";
import { type Range } from "@codemirror/state";
import {
  type ResolvedCrossref,
  findCrossrefs,
  resolveCrossref,
  equationLabelsField,
} from "../index/crossref-resolver";
import { cursorInRange, RenderWidget } from "./render-utils";

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
    span.className = "cf-crossref";
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
    span.className = "cf-crossref cf-crossref-unresolved";
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
  const equationLabels = view.state.field(equationLabelsField);

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
    widget.sourceTo = ref.to;
    items.push(
      Decoration.replace({ widget }).range(ref.from, ref.to),
    );
  }

  return items;
}

/**
 * @deprecated Use `referenceRenderPlugin` from `./reference-render` instead.
 * The standalone crossref ViewPlugin has been merged into the unified
 * reference render plugin. This module still exports the widget classes
 * and `collectCrossrefRanges` for tests and other consumers.
 */
