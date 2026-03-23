import { useEffect, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import { computePosition, flip, shift, offset } from "@floating-ui/dom";
import { collectFootnotes, mathMacrosField } from "../../render";
import { renderDocumentFragmentToDom } from "../../document-surfaces";

/**
 * Hover tooltip for sidenote refs when the margin is collapsed.
 *
 * Uses @floating-ui/dom for positioning (flip+shift middleware) to handle
 * viewport edge collisions correctly. Tooltip lifecycle is managed via
 * mouseover/mouseout event delegation on the editor's scrollDOM.
 */
export function useFootnoteTooltip(
  view: EditorView | null,
  sidenotesCollapsed: boolean | undefined,
): void {
  const getFootnoteContent = useCallback(
    (id: string): string | null => {
      if (!view) return null;
      const { defs } = collectFootnotes(view.state);
      const def = defs.get(id);
      return def ? def.content : null;
    },
    [view],
  );

  useEffect(() => {
    if (!view || !sidenotesCollapsed) return;

    const scroller = view.scrollDOM;
    let tooltip: HTMLDivElement | null = null;

    const show = (target: HTMLElement) => {
      const id = target.getAttribute("data-footnote-id");
      if (!id) return;
      const content = getFootnoteContent(id);
      if (!content) return;

      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "cf-hover-preview-tooltip";
        tooltip.setAttribute("data-visible", "false");
        document.body.appendChild(tooltip);
      }
      tooltip.innerHTML = "";
      const macros = view.state.field(mathMacrosField);
      renderDocumentFragmentToDom(tooltip, { kind: "footnote", text: content, macros });

      const el = tooltip;
      void computePosition(target, el, {
        placement: "bottom",
        middleware: [offset(4), flip(), shift({ padding: 5 })],
      }).then(({ x, y }) => {
        // Guard: tooltip may have been removed by hide() before resolve
        if (!el.isConnected) return;
        Object.assign(el.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
        // Trigger enter animation after positioning
        requestAnimationFrame(() => {
          if (el.isConnected) el.setAttribute("data-visible", "true");
        });
      });
    };

    const hide = () => {
      if (tooltip) {
        tooltip.remove();
        tooltip = null;
      }
    };

    const onOver = (e: Event) => {
      const target = (e as MouseEvent).target as HTMLElement;
      if (target.classList.contains("cf-sidenote-ref")) show(target);
    };
    const onOut = (e: Event) => {
      const target = (e as MouseEvent).target as HTMLElement;
      if (target.classList.contains("cf-sidenote-ref")) hide();
    };

    scroller.addEventListener("mouseover", onOver);
    scroller.addEventListener("mouseout", onOut);
    return () => {
      scroller.removeEventListener("mouseover", onOver);
      scroller.removeEventListener("mouseout", onOut);
      hide();
    };
  }, [view, sidenotesCollapsed, getFootnoteContent]);
}
