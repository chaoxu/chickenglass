import { useEffect } from "react";
import { EditorView } from "@codemirror/view";
import { sidenotesCollapsedEffect } from "../../render";

const AUTO_COLLAPSE_WIDTH = 700;

/**
 * Syncs the `sidenotesCollapsed` prop into the CM6 StateField and adjusts
 * `marginRight` on the content DOM.
 *
 * Also installs a ResizeObserver that auto-collapses the margin when the
 * editor container drops below AUTO_COLLAPSE_WIDTH pixels.
 */
export function useSidenotesAutoCollapse(
  view: EditorView | null,
  sidenotesCollapsed: boolean | undefined,
  onSidenotesCollapsedChange: ((collapsed: boolean) => void) | undefined,
): void {
  // Sync collapsed state into CM6 + adjust marginRight
  useEffect(() => {
    if (!view) return;
    const collapsed = sidenotesCollapsed ?? false;
    view.dispatch({ effects: sidenotesCollapsedEffect.of(collapsed) });
    view.contentDOM.style.marginRight = collapsed ? "auto" : "";
  }, [view, sidenotesCollapsed]);

  // Auto-collapse when container becomes too narrow
  useEffect(() => {
    if (!view || !onSidenotesCollapsedChange) return;
    const container = view.dom.parentElement;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width < AUTO_COLLAPSE_WIDTH && !sidenotesCollapsed) {
          onSidenotesCollapsedChange(true);
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [view, sidenotesCollapsed, onSidenotesCollapsedChange]);
}
