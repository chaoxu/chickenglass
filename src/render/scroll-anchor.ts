import { type EditorView } from "@codemirror/view";

interface ScrollAnchorSnapshot {
  readonly pos: number;
  readonly top: number;
}

interface ScrollAnchorMeasurement {
  readonly anchor: ScrollAnchorSnapshot | null;
  readonly currentTop: number | null;
}

function captureScrollAnchorSafely(
  view: EditorView,
): ScrollAnchorSnapshot | null {
  try {
    return captureScrollAnchor(view);
  } catch (_error) {
    return null;
  }
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

function measureScrollAnchor(
  view: EditorView,
  anchor: ScrollAnchorSnapshot | null,
): ScrollAnchorMeasurement {
  const effectiveAnchor = anchor ?? captureScrollAnchor(view);
  if (!effectiveAnchor) {
    return {
      anchor: null,
      currentTop: null,
    };
  }

  return {
    anchor: effectiveAnchor,
    currentTop: readScrollAnchorTop(view, effectiveAnchor.pos),
  };
}

function restoreMeasuredScrollAnchor(
  view: EditorView,
  measurement: ScrollAnchorMeasurement,
): void {
  if (!measurement.anchor || measurement.currentTop === null || !view.dom.isConnected) {
    return;
  }

  const delta = measurement.currentTop - measurement.anchor.top;
  if (delta !== 0) {
    view.scrollDOM.scrollTop += delta;
  }
}

export function requestScrollStabilizedMeasure(
  view: EditorView,
  anchor?: ScrollAnchorSnapshot | null,
): void {
  if (!view.dom.isConnected) return;
  const capturedAnchor = anchor === undefined
    ? captureScrollAnchorSafely(view)
    : anchor;

  view.requestMeasure({
    read: () => measureScrollAnchor(view, capturedAnchor ?? null),
    write: (measurement) => {
      restoreMeasuredScrollAnchor(view, measurement as ScrollAnchorMeasurement);
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

  const anchor = captureScrollAnchorSafely(view);
  mutate();
  requestScrollStabilizedMeasure(view, anchor);
}
