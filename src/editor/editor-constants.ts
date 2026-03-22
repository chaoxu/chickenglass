/**
 * Shared editor constants used across theme sub-modules.
 *
 * Kept in a dedicated file to avoid circular imports between theme.ts
 * (which imports sub-modules) and the sub-modules themselves.
 */

/** Default UI stack for app chrome. */
export const defaultUIFontStack =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Default prose stack for document content. */
export const defaultContentFontStack = 'KaTeX_Main, "Times New Roman", serif';

/** Default monospace stack, matching read mode code blocks. */
export const defaultCodeFontStack = 'Monaco, "DejaVu Sans Mono", Consolas, monospace';

/** UI font used throughout the app shell, theme-overridable via --cg-ui-font. */
export const uiFont = `var(--cg-ui-font, ${defaultUIFontStack})`;

/** Prose font used throughout document content, theme-overridable via --cg-content-font. */
export const contentFont = `var(--cg-content-font, ${defaultContentFontStack})`;

/** Monospace font used throughout the editor theme, theme-overridable via --cg-code-font. */
export const monoFont = `var(--cg-code-font, ${defaultCodeFontStack})`;
