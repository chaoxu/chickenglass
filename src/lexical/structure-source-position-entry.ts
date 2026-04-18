import { useCallback, type SyntheticEvent } from "react";
import type { LexicalEditor } from "lexical";

import { queuePendingSurfaceFocus } from "./pending-surface-focus";
import { readSourcePositionFromElement } from "./source-position-plugin";
import { SET_SOURCE_SELECTION_COMMAND } from "./source-selection-command";

export type StructureSourceOffsetMapper = (
  target: EventTarget | null,
  raw: string,
  clientX?: number,
) => number | null;

export function useStructureSourcePositionEntry({
  editor,
  raw,
  sourceFocusId,
  sourceOffsetFromTarget,
}: {
  readonly editor: LexicalEditor;
  readonly raw: string;
  readonly sourceFocusId: string;
  readonly sourceOffsetFromTarget: StructureSourceOffsetMapper;
}): (element: HTMLElement, event: SyntheticEvent) => void {
  return useCallback((element: HTMLElement, event: SyntheticEvent) => {
    const nativeEvent = event.nativeEvent;
    const clientX = nativeEvent instanceof MouseEvent ? nativeEvent.clientX : undefined;
    const sourceOffset = sourceOffsetFromTarget(event.target, raw, clientX);
    if (sourceOffset !== null) {
      queuePendingSurfaceFocus(sourceFocusId, { offset: sourceOffset });
    }
    const blockSourcePosition = readSourcePositionFromElement(element);
    if (blockSourcePosition === null) {
      return;
    }
    editor.dispatchCommand(
      SET_SOURCE_SELECTION_COMMAND,
      blockSourcePosition + (sourceOffset ?? 0),
    );
  }, [editor, raw, sourceFocusId, sourceOffsetFromTarget]);
}
