import { type Range } from "@codemirror/state";
import {
  Decoration,
  type WidgetType,
} from "@codemirror/view";

/**
 * Plugin-owned widget contract for render-side block adapters.
 *
 * The concrete widgets live in src/render/, but plugins only depend on this
 * source-range/lifecycle shape plus CodeMirror's WidgetType contract.
 */
export interface PluginRenderWidget extends WidgetType {
  sourceFrom: number;
  sourceTo: number;
  useLiveSourceRange: boolean;
  updateSourceRange(from: number, to: number): void;
}

/**
 * Plugin-owned factory seam for block chrome widgets.
 *
 * Render-side adapters implement these factories; plugin helpers own the
 * decoration placement policy and source-range semantics.
 */
export interface PluginRenderAdapter {
  createHeaderWidget(
    header: string,
    macros: Record<string, string>,
  ): PluginRenderWidget;
  createCaptionWidget(
    header: string,
    title: string,
    macros: Record<string, string>,
    active: boolean,
  ): PluginRenderWidget;
  createAttributeTitleWidget(
    title: string,
    macros: Record<string, string>,
  ): PluginRenderWidget;
}

const decorationHidden = Decoration.mark({ class: "cf-hidden" });

export function addPluginMarkerReplacement(
  markerFrom: number,
  markerTo: number,
  cursorInside: boolean,
  widget: PluginRenderWidget | null,
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

export function pushPluginHiddenDecoration(
  items: Range<Decoration>[],
  from: number,
  to: number,
): void {
  items.push(decorationHidden.range(from, to));
}

export function pushPluginWidgetDecoration(
  items: Range<Decoration>[],
  widget: PluginRenderWidget,
  from: number,
  to: number,
): void {
  widget.updateSourceRange(from, to);
  items.push(Decoration.replace({ widget }).range(from, to));
}
