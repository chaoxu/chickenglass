import { useEffect, useState } from "react";
import { TextNode, type LexicalEditor, type NodeKey } from "lexical";

import type { RevealAdapter } from "./cursor-reveal-adapters";
import { renderRevealChromePreview } from "./reveal-chrome";

export interface InlineRevealChromeState {
  readonly plainKey: NodeKey;
  readonly adapter: RevealAdapter;
  readonly source: string;
}

export function InlineRevealChrome({
  editor,
  onClose,
  state,
}: {
  readonly editor: LexicalEditor;
  readonly onClose: () => void;
  readonly state: InlineRevealChromeState | null;
}) {
  const anchor = useLexicalElementByKey(editor, state?.plainKey ?? null);

  if (!state) {
    return null;
  }

  const preview = state.adapter.getChromePreview?.(state.source) ?? null;
  if (!preview || !anchor) {
    return null;
  }

  return renderRevealChromePreview(preview, {
    anchor,
    onAnchorLost: onClose,
    source: state.source,
  });
}

function useLexicalElementByKey(
  editor: LexicalEditor,
  key: NodeKey | null,
): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(() => (
    key ? editor.getElementByKey(key) : null
  ));

  useEffect(() => {
    if (!key) {
      setElement(null);
      return undefined;
    }

    const resolve = () => {
      setElement(editor.getElementByKey(key));
    };
    resolve();
    return editor.registerMutationListener(TextNode, (mutations) => {
      if (mutations.has(key)) {
        resolve();
      }
    });
  }, [editor, key]);

  return element;
}
