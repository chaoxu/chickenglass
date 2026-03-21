import { EditorView } from "@codemirror/view";
import { baseThemeStyles } from "./base-theme";
import { typographyThemeStyles } from "./typography-theme";
import { codeThemeStyles } from "./code-theme";
import { blockThemeStyles } from "./block-theme";
import { marginThemeStyles } from "./margin-theme";

export { monoFont } from "./editor-constants";

/**
 * Composed editor theme for chickenglass — merges all semantic sub-modules
 * into a single CM6 theme extension. Uses CSS custom properties so that
 * light/dark switching only requires changing variables on the html element.
 */
export const chickenglassTheme = EditorView.theme({
  ...baseThemeStyles,
  ...typographyThemeStyles,
  ...codeThemeStyles,
  ...blockThemeStyles,
  ...marginThemeStyles,
});

/**
 * CM6 dark-mode base theme — tells CodeMirror the background is dark so it
 * picks appropriate defaults for its own UI (scroll gutter, etc.).
 * Applied when the resolved theme is "dark".
 */
export const chickenglassDarkTheme = EditorView.theme(
  {
    "&": {
      colorScheme: "dark",
    },
  },
  { dark: true },
);
