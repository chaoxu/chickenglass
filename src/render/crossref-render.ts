/**
 * Cross-reference widget classes.
 *
 * The ViewPlugin that used these has been merged into the unified
 * `referenceRenderPlugin` in `./reference-render.ts`. This module
 * exports the widget classes used by the rendering system.
 */

import { type WidgetType } from "@codemirror/view";
import { type ResolvedCrossref } from "../index/crossref-resolver";
import { CSS } from "../constants/css-classes";
import {
  ReferenceWidget,
  SimpleTextReferenceWidget,
} from "./reference-widget";

/** Widget for a resolved cross-reference (block or equation). */
export class CrossrefWidget extends SimpleTextReferenceWidget {
  constructor(
    private readonly resolved: ResolvedCrossref,
    raw: string,
  ) {
    super({
      className: CSS.crossref,
      text: resolved.label,
      ariaLabel: raw,
    });
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof CrossrefWidget &&
      this.resolved.kind === other.resolved.kind &&
      super.eq(other)
    );
  }
}

export interface ClusteredCrossrefPart {
  readonly id: string;
  readonly text: string;
  readonly unresolved?: boolean;
}

/**
 * Widget for a clustered cross-reference (multiple ids in one bracket).
 *
 * Renders one child `<span data-ref-id="...">` per item with plain "; " text
 * node separators, so hover-preview can target individual items (#397).
 * Unresolved items degrade in place instead of collapsing the whole cluster.
 */
export class ClusteredCrossrefWidget extends ReferenceWidget {
  constructor(
    private readonly parts: readonly ClusteredCrossrefPart[],
    raw: string,
  ) {
    super({
      className: CSS.crossref,
      ariaLabel: raw,
    });
  }

  createDOM(): HTMLElement {
    return this.createReferenceListDOM({
      ...this.rootSpec,
      items: this.parts.map((part) => ({
        id: part.id,
        text: part.text,
        ...(part.unresolved ? { className: CSS.crossrefUnresolved } : {}),
      })),
      separatorText: "; ",
    });
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof ClusteredCrossrefWidget)) return false;
    if (this.parts.length !== other.parts.length) return false;
    if (!this.hasSameReferenceRoot(other)) return false;
    return this.parts.every(
      (part, i) =>
        part.id === other.parts[i].id &&
        part.text === other.parts[i].text &&
        Boolean(part.unresolved) === Boolean(other.parts[i].unresolved),
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
export class MixedClusterWidget extends ReferenceWidget {
  constructor(
    private readonly parts: readonly MixedClusterPart[],
    raw: string,
  ) {
    super({
      className: CSS.citation,
      ariaLabel: raw,
    });
  }

  createDOM(): HTMLElement {
    return this.createReferenceListDOM({
      ...this.rootSpec,
      items: this.parts.map((part) => ({
        id: part.id,
        text: part.text,
      })),
      prefixText: "(",
      separatorText: "; ",
      suffixText: ")",
    });
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof MixedClusterWidget)) return false;
    if (this.parts.length !== other.parts.length) return false;
    if (!this.hasSameReferenceRoot(other)) return false;
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
export class UnresolvedRefWidget extends SimpleTextReferenceWidget {
  constructor(private readonly raw: string) {
    super({
      className: CSS.crossrefUnresolved,
      text: stripBracketSyntax(raw),
      ariaLabel: "Unresolved reference",
    });
  }

  override eq(other: WidgetType): boolean {
    return other instanceof UnresolvedRefWidget && this.raw === other.raw;
  }
}
