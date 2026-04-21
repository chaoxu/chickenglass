import { findInlineNeutralAnchor } from "../inline-fragments";
import { isReferenceWidgetTarget } from "./reference-widget";
import {
  renderInlineMarkdown,
  type InlineReferenceRenderContext,
} from "./inline-render";

export function restoreRenderedTableCell(
  cell: HTMLElement,
  content: string,
  macros: Record<string, string>,
  referenceContext: InlineReferenceRenderContext | undefined,
): void {
  cell.innerHTML = "";
  renderInlineMarkdown(
    cell,
    content,
    macros,
    "table-preview-inline",
    referenceContext,
  );
}

export function isRenderedTableInlineTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isReferenceWidgetTarget(target)) return true;
  return Boolean(
    target.closest(
      [
        ".katex",
        ".cross-ref",
        ".cf-link-rendered",
        ".cf-inline-code",
        ".cf-highlight",
        ".cf-bold",
        ".cf-italic",
        ".cf-strikethrough",
        "strong",
        "em",
        "del",
        "mark",
        "code",
      ].join(", "),
    ),
  );
}

export function findTableInlineNeutralAnchor(content: string): number | null {
  return findInlineNeutralAnchor(content);
}
