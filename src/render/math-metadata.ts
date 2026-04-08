import { type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Extension, type StateField } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import { MathWidget } from "./math-widget";
import { widgetSourceMap } from "./widget-core";

function clearSourceRangeAttrs(el: HTMLElement): void {
  delete el.dataset.sourceFrom;
  delete el.dataset.sourceTo;
  widgetSourceMap.delete(el);
}

function collectRenderedMathWidgets(
  view: EditorView,
  mathDecorationField: StateField<DecorationSet>,
): Map<number, MathWidget> {
  const widgets = new Map<number, MathWidget>();
  const decorations = view.state.field(mathDecorationField, false);
  if (!decorations) {
    return widgets;
  }
  const cursor = decorations.iter();
  while (cursor.value) {
    const widget = cursor.value.spec?.widget;
    if (widget instanceof MathWidget && widget.sourceFrom >= 0) {
      widgets.set(widget.sourceFrom, widget);
    }
    cursor.next();
  }
  return widgets;
}

function isWidgetVisible(
  widget: MathWidget,
  visibleRanges: readonly { from: number; to: number }[],
): boolean {
  return visibleRanges.some(
    (range) => widget.sourceFrom < range.to && widget.sourceTo > range.from,
  );
}

function collectVisibleRenderedMathWidgets(
  view: EditorView,
  mathDecorationField: StateField<DecorationSet>,
): MathWidget[] {
  const widgetsByFrom = collectRenderedMathWidgets(view, mathDecorationField);
  return [...widgetsByFrom.values()].filter(
    (widget) => isWidgetVisible(widget, view.visibleRanges),
  );
}

function syncRenderedMathWidgetMetadata(
  view: EditorView,
  mathDecorationField: StateField<DecorationSet>,
): void {
  const widgets = collectVisibleRenderedMathWidgets(view, mathDecorationField);
  const mathRoots = view.contentDOM.querySelectorAll<HTMLElement>(
    `.${CSS.mathInline}, .${CSS.mathDisplay}`,
  );
  const count = Math.min(mathRoots.length, widgets.length);

  for (let i = 0; i < count; i++) {
    const el = mathRoots[i];
    const widget = widgets[i];
    el.dataset.sourceFrom = String(widget.sourceFrom);
    el.dataset.sourceTo = String(widget.sourceTo);
    widgetSourceMap.set(el, widget);
  }

  for (let i = count; i < mathRoots.length; i++) {
    clearSourceRangeAttrs(mathRoots[i]);
  }
}

export function createMathWidgetMetadataPlugin(
  mathDecorationField: StateField<DecorationSet>,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private syncScheduled = false;

      constructor(view: EditorView) {
        this.scheduleSync(view);
      }

      update(update: ViewUpdate) {
        if (
      update.docChanged
          || update.selectionSet
          || update.focusChanged
          || update.viewportChanged
          || update.state.field(mathDecorationField, false)
            !== update.startState.field(mathDecorationField, false)
        ) {
          this.scheduleSync(update.view);
        }
      }

      private scheduleSync(view: EditorView): void {
        if (this.syncScheduled) return;
        this.syncScheduled = true;
        view.requestMeasure({
          read: () => null,
          write: () => {
            this.syncScheduled = false;
            if (!view.dom.isConnected) return;
            syncRenderedMathWidgetMetadata(view, mathDecorationField);
          },
        });
      }
    },
  );
}
