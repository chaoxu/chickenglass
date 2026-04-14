import { useCallback, type KeyboardEvent, type MouseEvent, type SyntheticEvent } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";

import { COFLAT_NESTED_EDIT_TAG } from "../update-tags";

type RawUpdatableNode = {
  getRaw?: () => string;
  setRaw?: (value: string) => unknown;
};

/** Prevent browser from placing a stray caret in non-editable KaTeX content. */
export function preventKatexMouseDown(event: MouseEvent) {
  event.preventDefault();
}

export function structureToggleProps(
  active: boolean,
  onActivate: () => void,
  options?: { stopPropagation?: boolean },
): Record<string, unknown> {
  if (!active) return {};

  const stop = options?.stopPropagation;
  return {
    onClick: (event: SyntheticEvent) => {
      event.preventDefault();
      if (stop) {
        event.stopPropagation();
      }
      onActivate();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (stop) {
          event.stopPropagation();
        }
        onActivate();
      }
    },
    role: "button",
    tabIndex: 0,
  };
}

export function useRawBlockUpdater(nodeKey: NodeKey): (raw: string) => void {
  const [editor] = useLexicalComposerContext();

  return useCallback((nextRaw: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey) as RawUpdatableNode | null;
      if (!node?.setRaw || node.getRaw?.() === nextRaw) {
        return;
      }
      node.setRaw(nextRaw);
    }, {
      discrete: true,
      tag: COFLAT_NESTED_EDIT_TAG,
    });
  }, [editor, nodeKey]);
}
