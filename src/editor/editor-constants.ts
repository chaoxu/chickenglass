/**
 * Shared editor constants used across theme sub-modules.
 *
 * Kept in a dedicated file to avoid circular imports between theme.ts
 * (which imports sub-modules) and the sub-modules themselves.
 */

/** Default monospace stack, matching read mode code blocks. */
export const defaultCodeFontStack = 'Monaco, "DejaVu Sans Mono", Consolas, monospace';

/** Monospace font used throughout the editor theme, theme-overridable via --cg-code-font. */
export const monoFont = `var(--cg-code-font, ${defaultCodeFontStack})`;
