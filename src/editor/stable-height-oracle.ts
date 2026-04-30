import { type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";

interface TextSizeMeasurement {
  readonly lineHeight: number;
  readonly charWidth: number;
  readonly textHeight: number;
}

interface PatchableDocView {
  measureTextSize: () => TextSizeMeasurement;
}

interface ObserverLike {
  ignore: (fn: () => void) => void;
}

interface PrivateEditorView {
  readonly docView?: PatchableDocView;
  readonly observer?: ObserverLike;
}

const MEASURE_TEXT = "abc def ghi jkl mno pqr stu";
const patchedDocViews = new WeakMap<PatchableDocView, () => TextSizeMeasurement>();

function asPrivateView(view: EditorView): PrivateEditorView {
  return view as unknown as PrivateEditorView;
}

function readTextRect(parent: HTMLElement): DOMRect | undefined {
  const document = parent.ownerDocument;
  const range = document.createRange();
  range.selectNodeContents(parent);
  const rect = range.getClientRects()[0];
  range.detach();
  return rect;
}

function runIgnored(view: EditorView, fn: () => void): void {
  const observer = asPrivateView(view).observer;
  if (observer) {
    observer.ignore(fn);
    return;
  }
  fn();
}

function measureStableTextSize(view: EditorView): TextSizeMeasurement | null {
  const dummy = view.contentDOM.ownerDocument.createElement("div");
  dummy.className = "cm-line";
  dummy.style.width = "99999px";
  dummy.style.position = "absolute";
  dummy.style.visibility = "hidden";
  dummy.textContent = MEASURE_TEXT;

  let measurement: TextSizeMeasurement | null = null;
  runIgnored(view, () => {
    view.contentDOM.appendChild(dummy);
    const lineRect = dummy.getBoundingClientRect();
    const textRect = readTextRect(dummy);
    if (lineRect.height > 0 && textRect && textRect.width > 0) {
      measurement = {
        lineHeight: lineRect.height,
        charWidth: textRect.width / MEASURE_TEXT.length,
        textHeight: textRect.height || lineRect.height,
      };
    }
    dummy.remove();
  });

  return measurement;
}

function installStableHeightOracle(view: EditorView): PatchableDocView | null {
  const docView = asPrivateView(view).docView;
  if (!docView || patchedDocViews.has(docView)) return null;

  const original = docView.measureTextSize.bind(docView);
  docView.measureTextSize = () => measureStableTextSize(view) ?? original();
  patchedDocViews.set(docView, original);
  return docView;
}

function uninstallStableHeightOracle(docView: PatchableDocView | null): void {
  if (!docView) return;
  const original = patchedDocViews.get(docView);
  if (!original) return;
  docView.measureTextSize = original;
  patchedDocViews.delete(docView);
}

class StableHeightOraclePlugin implements PluginValue {
  private docView: PatchableDocView | null = null;
  private destroyed = false;

  constructor(view: EditorView) {
    this.install(view);
    queueMicrotask(() => {
      if (!this.destroyed) this.install(view);
    });
  }

  private install(view: EditorView): void {
    this.docView ??= installStableHeightOracle(view);
  }

  update(update: ViewUpdate): void {
    this.install(update.view);
  }

  destroy(): void {
    this.destroyed = true;
    uninstallStableHeightOracle(this.docView);
  }
}

/**
 * CM6's wrapped-line height oracle samples arbitrary short visible document
 * lines to infer average character width. In a proportional math/prose editor,
 * that makes offscreen wrapped-line estimates depend on whether the viewport
 * happens to contain source fences, code text, or prose. Use one stable probe
 * string instead so scroll height estimates are deterministic.
 */
export const stableHeightOracleExtension: Extension = ViewPlugin.fromClass(
  StableHeightOraclePlugin,
);
