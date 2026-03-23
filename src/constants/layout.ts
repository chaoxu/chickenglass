/**
 * Layout dimension constants used across the Coflat editor and themes.
 *
 * All values are CSS string literals (or percentages) matching the design
 * system so they can be used directly in CM6 theme objects and inline styles.
 */

/** Maximum width of the editor content column. */
export const CONTENT_MAX_WIDTH = "800px";

/**
 * Minimum right margin reserved for sidenotes and margin annotations.
 * Applied as: `max(224px, calc((100% - 800px) / 2))`.
 */
export const MARGIN_RIGHT_CALC = "224px";

/** Horizontal offset of sidenote widgets from the right edge of the viewport. */
export const SIDENOTE_OFFSET = "-280px";

/** Width of a sidenote margin widget. */
export const SIDENOTE_WIDTH = "240px";

/** Maximum height for image widgets in the rendered editor. */
export const IMAGE_MAX_HEIGHT = "400px";

/** Fixed height for embed iframe widgets (non-YouTube). */
export const EMBED_IFRAME_HEIGHT = "350px";

/** Minimum height for Gist embed iframes before content loads. */
export const GIST_MIN_HEIGHT = "200px";

/** Padding-bottom percentage for a 16:9 aspect-ratio iframe container. */
export const ASPECT_RATIO_16_9 = "56.25%";

/** Vertical padding (top and bottom) for the editor content area. */
export const CONTENT_PADDING_Y = "24px";

/** Horizontal padding (left and right) for the editor content area. */
export const CONTENT_PADDING_X = "48px";

/** Maximum width of the hover-preview tooltip. */
export const HOVER_PREVIEW_MAX_WIDTH = "400px";

/** Maximum height of the hover-preview tooltip. */
export const HOVER_PREVIEW_MAX_HEIGHT = "300px";

/** Right margin gap on the sidenote number label. */
export const SIDENOTE_NUMBER_MARGIN_RIGHT = "3px";

/** Right offset of the include-label relative to its anchor element. */
export const INCLUDE_LABEL_RIGHT = "-44px";

/** Top offset of the include-label within its anchor element. */
export const INCLUDE_LABEL_TOP = "2px";

/** Font size for the include-label rotated filename. */
export const INCLUDE_LABEL_FONT_SIZE = "10px";

/** Letter-spacing for the include-label rotated filename. */
export const INCLUDE_LABEL_LETTER_SPACING = "0.3px";
