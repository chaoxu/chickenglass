import { useEffect, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import { collectFootnotes, mathMacrosField } from "../../render";
import { renderDocumentFragmentToDom } from "../../document-surfaces";

/**
 * Hover tooltip for sidenote refs when the margin is collapsed.
 *
 * Manual positioning via getBoundingClientRect is sufficient — the tooltip
 * is small (max-width 320px), pointer-events:none, and only appears on
 * hover. @floating-ui was evaluated (#180, #189) but rejected for this
 * use case: minimal collision risk and the bundle cost (~8KB) is not
 * justified for 2 trivial positioning sites in the codebase.
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
        document.body.appendChild(tooltip);
      }
      tooltip.innerHTML = "";
      const macros = view.state.field(mathMacrosField);
      renderDocumentFragmentToDom(tooltip, { kind: "footnote", text: content, macros });
      const rect = target.getBoundingClientRect();
      tooltip.style.left = `${rect.left}px`;
      tooltip.style.top = `${rect.bottom + 4}px`;
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
