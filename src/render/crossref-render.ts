/**
 * Cross-reference widget classes.
 *
 * The ViewPlugin that used these has been merged into the unified
 * `referenceRenderPlugin` in `./reference-render.ts`. This module
 * exports the widget classes used by the rendering system.
 */

import {
  type ResolvedCrossref,
} from "../index/crossref-resolver";
import {
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
      attrs: { "aria-label": raw },
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
    container.setAttribute("aria-label", this.raw);
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
        this.ids[i] === other.ids[i] &&
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
    container.setAttribute("aria-label", this.raw);
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
      (p, i) =>
        p.id === other.parts[i].id &&
        p.kind === other.parts[i].kind &&
        p.text === other.parts[i].text,
    );
  }
}

/**
 * Strip bracketed reference syntax to extract a display-friendly ID.
 * `[@cormen2009]` → `cormen2009`, `[@foo; @bar]` → `foo; bar`,
 * `@id` → `@id` (narrative refs kept as-is).
 */
function stripBracketSyntax(raw: string): string {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    // Remove outer brackets, then strip leading @ from each ;-separated id
    return raw
      .slice(1, -1)
      .split(";")
      .map((part) => part.trim().replace(/^@/, ""))
      .join("; ");
  }
  return raw;
}

/** Widget for an unresolved cross-reference.
 *
 * Display text strips bracket syntax for visual parity with the table
 * display path (`renderInlineMarkdown`), which renders `[@id]` as just
 * the bare id text (#406). The full raw source is kept as the tooltip.
 */
export class UnresolvedRefWidget extends SimpleTextRenderWidget {
  constructor(private readonly raw: string) {
    super({
      tagName: "span",
      className: "cf-crossref cf-crossref-unresolved",
      text: stripBracketSyntax(raw),
      attrs: { "aria-label": "Unresolved reference" },
    });
  }

  eq(other: UnresolvedRefWidget): boolean {
    return this.raw === other.raw;
  }
}

