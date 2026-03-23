/**
 * Cross-reference widget classes and collection helper.
 *
 * The ViewPlugin that used these has been merged into the unified
 * `referenceRenderPlugin` in `./reference-render.ts`. This module
 * still exports widget classes and `collectCrossrefRanges` for
 * tests and other consumers.
 */

import {
  Decoration,
  type EditorView,
} from "@codemirror/view";
import { type Range } from "@codemirror/state";
import {
  type ResolvedCrossref,
  resolveCrossref,
} from "../index/crossref-resolver";
import { documentAnalysisField } from "../semantics/codemirror-source";
import {
  cursorInRange,
  pushWidgetDecoration,
  RenderWidget,
  SimpleTextRenderWidget,
} from "./render-utils";

/** Widget for a resolved cross-reference (block or equation). */
export class CrossrefWidget extends SimpleTextRenderWidget {
  constructor(
    private readonly resolved: ResolvedCrossref,
    private readonly raw: string,
  ) {
    super({
      tagName: "span",
      className: "cf-crossref",
      text: resolved.label,
      title: raw,
    });
  }

  eq(other: CrossrefWidget): boolean {
    return (
      this.resolved.kind === other.resolved.kind &&
      this.resolved.label === other.resolved.label &&
      this.raw === other.raw
    );
  }
}

/**
 * Widget for a clustered cross-reference (multiple resolved crossrefs in one bracket).
 *
 * Renders one child `<span data-ref-id="...">` per item with plain "; " text
 * node separators, so hover-preview can target individual items (#397).
 */
export class ClusteredCrossrefWidget extends RenderWidget {
  constructor(
    private readonly resolvedItems: readonly ResolvedCrossref[],
    private readonly ids: readonly string[],
    private readonly raw: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cf-crossref";
    container.title = this.raw;
    for (let i = 0; i < this.resolvedItems.length; i++) {
      if (i > 0) {
        container.appendChild(document.createTextNode("; "));
      }
      const span = document.createElement("span");
      span.setAttribute("data-ref-id", this.ids[i]);
      span.textContent = this.resolvedItems[i].label;
      container.appendChild(span);
    }
    return container;
  }

  eq(other: ClusteredCrossrefWidget): boolean {
    if (this.resolvedItems.length !== other.resolvedItems.length) return false;
    if (this.raw !== other.raw) return false;
    return this.resolvedItems.every(
      (r, i) =>
        r.kind === other.resolvedItems[i].kind &&
        r.label === other.resolvedItems[i].label,
    );
  }
}

/**
 * A single part in a mixed cluster (crossref + citation).
 * Each part is either a resolved crossref label or a formatted citation string.
 */
export interface MixedClusterPart {
  readonly kind: "crossref" | "citation";
  readonly id: string;
  readonly text: string;
}

/**
 * Widget for a mixed crossref+citation cluster like '[@eq:foo; @smith2020]'.
 *
 * Renders one child `<span data-ref-id="...">` per item with plain "; " text
 * node separators, wrapped in outer parens, so hover-preview can target
 * individual items (#397).
 */
export class MixedClusterWidget extends RenderWidget {
  constructor(
    private readonly parts: readonly MixedClusterPart[],
    private readonly raw: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cf-citation";
    container.title = this.raw;
    container.appendChild(document.createTextNode("("));
    for (let i = 0; i < this.parts.length; i++) {
      if (i > 0) {
        container.appendChild(document.createTextNode("; "));
      }
      const span = document.createElement("span");
      span.setAttribute("data-ref-id", this.parts[i].id);
      span.textContent = this.parts[i].text;
      container.appendChild(span);
    }
    container.appendChild(document.createTextNode(")"));
    return container;
  }

  eq(other: MixedClusterWidget): boolean {
    if (this.parts.length !== other.parts.length) return false;
    if (this.raw !== other.raw) return false;
    return this.parts.every(
      (p, i) => p.kind === other.parts[i].kind && p.text === other.parts[i].text,
    );
  }
}

/** Widget for an unresolved cross-reference. */
export class UnresolvedRefWidget extends SimpleTextRenderWidget {
  constructor(private readonly raw: string) {
    super({
      tagName: "span",
      className: "cf-crossref cf-crossref-unresolved",
      text: raw,
      title: "Unresolved reference",
    });
  }

  eq(other: UnresolvedRefWidget): boolean {
    return this.raw === other.raw;
  }
}

/** Collect decoration ranges for cross-references outside the cursor. */
export function collectCrossrefRanges(view: EditorView): Range<Decoration>[] {
  const analysis = view.state.field(documentAnalysisField);
  const allRefs = analysis.references;
  const equationLabels = analysis.equationById;
  const items: Range<Decoration>[] = [];

  for (const ref of allRefs) {
    if (ref.ids.length !== 1) continue;
    if (cursorInRange(view, ref.from, ref.to)) continue;

    const raw = view.state.sliceDoc(ref.from, ref.to);
    const resolved = resolveCrossref(view.state, ref.ids[0], equationLabels);

    // Skip citations — let the citation render plugin handle them
    if (resolved.kind === "citation") continue;

    const widget: RenderWidget =
      resolved.kind === "block" || resolved.kind === "equation"
        ? new CrossrefWidget(resolved, raw)
        : new UnresolvedRefWidget(raw);
    pushWidgetDecoration(items, widget, ref.from, ref.to);
  }

  return items;
}
