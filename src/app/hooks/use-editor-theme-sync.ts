import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { themeCompartment, coflatDarkTheme } from "../../editor";
import type { ResolvedTheme } from "../theme-dom";

export function useEditorThemeSync(
  view: EditorView | null,
  theme: ResolvedTheme | undefined,
): void {
  useEffect(() => {
    if (!view) return;
    const isDark = theme === "dark";
    try {
      view.dispatch({
        effects: themeCompartment.reconfigure(isDark ? coflatDarkTheme : []),
      });
    } catch (_e) {
      // best-effort: view may be destroyed during React effect teardown
    }
  }, [view, theme]);
}
