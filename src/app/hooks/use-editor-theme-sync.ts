import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { themeCompartment } from "../../editor/editor";
import { coflatDarkTheme } from "../../editor/theme";
import type { ResolvedTheme } from "./use-editor";

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
    } catch {
      // best-effort: view may be destroyed during React effect teardown
    }
  }, [view, theme]);
}
