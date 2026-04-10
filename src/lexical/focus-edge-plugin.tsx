import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";

export const COFLAT_FOCUS_EDGE_EVENT = "coflat:focus-edge";

type FocusEdge = "start" | "end";

export function FocusEdgePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerRootListener((rootElement, previousRootElement) => {
    const detach = (element: HTMLElement | null) => {
      if (!element) {
        return;
      }
      element.removeEventListener(COFLAT_FOCUS_EDGE_EVENT, handleFocusEdge as EventListener);
    };

    const handleFocusEdge = (event: Event) => {
      const edge = (event as CustomEvent<{ readonly edge?: FocusEdge }>).detail?.edge ?? "start";
      editor.update(() => {
        const root = $getRoot();
        if (edge === "end") {
          root.selectEnd();
          return;
        }
        root.selectStart();
      }, { discrete: true });
      editor.focus();
    };

    detach(previousRootElement);

    if (!rootElement) {
      return;
    }

    rootElement.addEventListener(COFLAT_FOCUS_EDGE_EVENT, handleFocusEdge as EventListener);
    return () => {
      detach(rootElement);
    };
  }), [editor]);

  return null;
}
