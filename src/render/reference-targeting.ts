import type { EditorView } from "@codemirror/view";
import { documentAnalysisField } from "../semantics/codemirror-source";
import type { ReferenceSemantics } from "../semantics/document";
import { resolveLiveWidgetSourceRange } from "./source-widget";

/**
 * Resolve the source reference occurrence for a rendered reference widget.
 *
 * Reference widgets already own a live source range via `RenderWidget`.
 * Reuse that range plus the semantics layer's indexed `referenceByFrom`
 * lookup instead of rescanning `analysis.references`.
 */
export function findRenderedReference(
  view: EditorView,
  widgetEl: HTMLElement,
): ReferenceSemantics | undefined {
  const analysis = view.state.field(documentAnalysisField, false);
  if (!analysis) return undefined;

  const sourceRange = resolveLiveWidgetSourceRange(view, widgetEl);
  if (!sourceRange) return undefined;

  return analysis.referenceByFrom.get(sourceRange.from);
}
