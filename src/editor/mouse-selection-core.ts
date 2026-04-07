import { EditorSelection } from "@codemirror/state";

export function isPlainPrimaryMouseEvent(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export interface PointerSelectionTarget {
  readonly pos: number;
  readonly assoc: number;
}

export function buildPointerSelection(
  start: PointerSelectionTarget,
  current: PointerSelectionTarget,
): EditorSelection {
  let range = EditorSelection.cursor(current.pos, current.assoc);
  if (start.pos !== current.pos) {
    const startRange = EditorSelection.cursor(start.pos, start.assoc);
    const from = Math.min(startRange.from, range.from);
    const to = Math.max(startRange.to, range.to);
    range = from < range.from
      ? EditorSelection.range(from, to, range.assoc)
      : EditorSelection.range(to, from, range.assoc);
  }
  return EditorSelection.create([range]);
}
