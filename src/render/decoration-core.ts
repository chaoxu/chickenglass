import {
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import {
  type Range,
  RangeSetBuilder,
} from "@codemirror/state";
import { RenderWidget } from "./source-widget";

/** Shared Decoration.mark that visually hides source markers via CSS while keeping them in the DOM. */
export const decorationHidden = Decoration.mark({ class: "cf-hidden" });

/**
 * Heading-like marker replacement pattern.
 *
 * Both ATX headings and fenced div block headers follow the same principle:
 *
 *   1. A syntactic marker (# or ::: {.class}) is hidden/replaced when cursor is outside.
 *   2. Content text after the marker stays as normal editable document content.
 *   3. Inline render plugins handle the content naturally.
 *   4. When cursor enters the marker area, the marker becomes source.
 *
 * This must never replace the full line with a single widget, or inline content
 * inside the heading/block title stops rendering naturally.
 */
export function addMarkerReplacement(
  markerFrom: number,
  markerTo: number,
  cursorInside: boolean,
  widget: RenderWidget | null,
  items: Range<Decoration>[],
): void {
  if (cursorInside) return;
  if (markerFrom >= markerTo) return;

  if (widget) {
    widget.updateSourceRange(markerFrom, markerTo);
    items.push(Decoration.replace({ widget }).range(markerFrom, markerTo));
    return;
  }

  items.push(decorationHidden.range(markerFrom, markerTo));
}

/** Check whether an array of ranges is already sorted by (from, to). */
function isSorted(items: ReadonlyArray<Range<Decoration>>): boolean {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    if (
      prev.from > curr.from ||
      (prev.from === curr.from && (
        prev.value.startSide > curr.value.startSide ||
        (prev.value.startSide === curr.value.startSide && prev.to > curr.to)
      ))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Build a DecorationSet from an array of decoration ranges.
 * Sorts by position before building (RangeSetBuilder requires sorted input).
 * Skips the sort when items are already in order.
 */
export function buildDecorations(
  items: ReadonlyArray<Range<Decoration>>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ordered = isSorted(items)
    ? items
    : [...items].sort(
        (left, right) => left.from - right.from ||
          left.value.startSide - right.value.startSide ||
          left.to - right.to,
      );
  for (const item of ordered) {
    builder.add(item.from, item.to, item.value);
  }
  return builder.finish();
}

/**
 * Push a widget replacement decoration, setting source range for click-to-edit.
 */
export function pushWidgetDecoration(
  items: Range<Decoration>[],
  widget: RenderWidget,
  from: number,
  to: number,
): void {
  widget.updateSourceRange(from, to);
  items.push(Decoration.replace({ widget }).range(from, to));
}

/**
 * Push a block widget replacement decoration, setting source range for
 * click-to-edit.
 */
export function pushBlockWidgetDecoration(
  items: Range<Decoration>[],
  widget: RenderWidget,
  from: number,
  to: number,
): void {
  widget.updateSourceRange(from, to);
  items.push(Decoration.replace({ widget, block: true }).range(from, to));
}
