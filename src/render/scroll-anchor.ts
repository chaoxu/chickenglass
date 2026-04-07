import { type EditorView } from "@codemirror/view";

interface ScrollAnchorSnapshot {
  readonly pos: number;
  readonly top: number;
}

function readScrollAnchorTop(
  view: EditorView,
  pos: number,
): number | null {
  const coords = view.coordsAtPos(pos, 1) ?? view.coordsAtPos(pos, -1);
  return coords?.top ?? null;
}

export function captureScrollAnchor(view: EditorView): ScrollAnchorSnapshot | null {
  if (!view.dom.isConnected) return null;

  const anchorPos = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
  const top = readScrollAnchorTop(view, anchorPos);
  return top === null ? null : { pos: anchorPos, top };
}

export function restoreScrollAnchor(
  view: EditorView,
  anchor: ScrollAnchorSnapshot | null,
): void {
  if (!anchor || !view.dom.isConnected) return;

  const top = readScrollAnchorTop(view, anchor.pos);
  if (top === null) return;

  const delta = top - anchor.top;
  if (delta !== 0) {
    view.scrollDOM.scrollTop += delta;
  }
}

export function requestScrollStabilizedMeasure(
  view: EditorView,
  anchor: ScrollAnchorSnapshot | null = captureScrollAnchor(view),
): void {
  if (!view.dom.isConnected) return;

  view.requestMeasure({
    read: () => anchor,
    write: (capturedAnchor) => {
      restoreScrollAnchor(view, capturedAnchor);
    },
  });
}

export function mutateWithScrollStabilizedMeasure(
  view: EditorView | null | undefined,
  mutate: () => void,
): void {
  if (!view?.dom.isConnected) {
    mutate();
    return;
  }

  const anchor = captureScrollAnchor(view);
  mutate();
  requestScrollStabilizedMeasure(view, anchor);
}
