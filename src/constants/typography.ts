/**
 * Typography baseline constants — single source of truth for the baseline
 * type scale and default transition timing.
 *
 * These are imported by the theme contract, theme presets, app settings, and
 * export CSS so changing the default font size, line height, or transition
 * timing happens in one place.
 */

export const BASE_FONT_SIZE_PX = 16;
export const BASE_LINE_HEIGHT = 1.5;

export const BASE_FONT_SIZE_CSS = `${BASE_FONT_SIZE_PX}px`;
export const BASE_LINE_HEIGHT_CSS = String(BASE_LINE_HEIGHT);

export const DEFAULT_TRANSITION = "0.15s ease";
