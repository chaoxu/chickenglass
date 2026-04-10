import { type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Extension, type StateField } from "@codemirror/state";
import { CSS } from "../constants/css-classes";
import { rangesIntersect } from "../lib/range-helpers";
import { MathWidget } from "./math-widget";
import {
  clearActiveFenceGuideClasses,
  syncActiveFenceGuideClasses,
  widgetSourceMap,
} from "./source-widget";

function clearSourceRangeAttrs(el: HTMLElement): void {
  delete el.dataset.sourceFrom;
  delete el.dataset.sourceTo;
  delete el.dataset.activeFenceGuides;
  clearActiveFenceGuideClasses(el);
  widgetSourceMap.delete(el);
}

interface RenderedMathWidget {
  readonly widget: MathWidget;
  readonly from: number;
  readonly to: number;
}

function collectRenderedMathWidgets(
  view: EditorView,
  mathDecorationField: StateField<DecorationSet>,
): RenderedMathWidget[] {
  const widgets: RenderedMathWidget[] = [];
  const decorations = view.state.field(mathDecorationField, false);
  if (!decorations) {
    return widgets;
  }
  const cursor = decorations.iter();
  while (cursor.value) {
    const widget = cursor.value.spec?.widget;
    if (widget instanceof MathWidget) {
      widgets.push({ widget, from: cursor.from, to: cursor.to });
    }
    cursor.next();
  }
  return widgets;
}

function collectVisibleRenderedMathWidgets(
  view: EditorView,
  mathDecorationField: StateField<DecorationSet>,
): RenderedMathWidget[] {
  const widgets = collectRenderedMathWidgets(view, mathDecorationField);
  return widgets.filter(
    (widget) => rangesIntersect(widget, view.viewport),
  );
}

function syncRenderedMathWidgetMetadata(
  view: EditorView,
  mathDecorationField: StateField<DecorationSet>,
): void {
  const widgets = collectVisibleRenderedMathWidgets(view, mathDecorationField);
  const mathRoots = view.dom.querySelectorAll<HTMLElement>(
    `.${CSS.mathInline}, .${CSS.mathDisplay}`,
  );
  const count = Math.min(mathRoots.length, widgets.length);

  for (let i = 0; i < count; i++) {
    const el = mathRoots[i];
    const { widget, from, to } = widgets[i];
    el.dataset.sourceFrom = String(from);
    el.dataset.sourceTo = String(to);
    el.dataset.activeFenceGuides = "true";
    syncActiveFenceGuideClasses(el, view, from, to);
    widget.updateSourceRange(from, to);
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
