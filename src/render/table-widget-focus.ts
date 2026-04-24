import type { EditorView } from "@codemirror/view";
import type { TableRange } from "./table-discovery";
import type { TableBoundaryHandoffDirection } from "./table-widget-navigation";
import { clearActivePreviewCell } from "./table-widget-session";

export function focusRootOutsideTableWithRange(
  rootView: EditorView,
  tableRange: TableRange,
  direction: TableBoundaryHandoffDirection,
): boolean {
  if (!rootView.dom.isConnected) return false;

  const doc = rootView.state.doc;
  const baselineScrollTop = rootView.scrollDOM.scrollTop;
  const startLine = doc.lineAt(tableRange.from);
  const endLine = doc.lineAt(Math.max(tableRange.from, tableRange.to - 1));
  const targetPos = direction === "before"
    ? Math.max(0, startLine.from - 1)
    : Math.min(doc.length, endLine.to + 1);
  const preserveDirectionalScroll = (): void => {
    const currentScrollTop = rootView.scrollDOM.scrollTop;
    const nextScrollTop = direction === "after"
      ? Math.max(currentScrollTop, baselineScrollTop)
      : Math.min(currentScrollTop, baselineScrollTop);
    if (nextScrollTop !== currentScrollTop) {
      rootView.scrollDOM.scrollTop = nextScrollTop;
    }
  };

  clearActivePreviewCell();
  rootView.dispatch({
    selection: { anchor: targetPos },
    scrollIntoView: false,
    userEvent: "select",
  });
  preserveDirectionalScroll();
  rootView.focus();
  preserveDirectionalScroll();
  requestAnimationFrame(() => {
    if (!rootView.dom.isConnected) return;
    rootView.focus();
    rootView.dispatch({
      selection: { anchor: targetPos },
      scrollIntoView: false,
      userEvent: "select",
    });
    preserveDirectionalScroll();
  });
  return true;
}
