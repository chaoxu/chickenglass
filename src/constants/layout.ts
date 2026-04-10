/**
 * Layout dimension constants used across the Coflat editor and themes.
 *
 * All values are CSS string literals (or percentages) matching the design
 * system so they can be used directly in inline styles and theme presets.
 */

/**
 * Maximum width of the editor content column.
 * 800 px is a comfortable line length for prose (~75-85 characters in the
 * default serif font), matching the academic/blog column widths that inspired
 * the Coflat design.
 */
export const CONTENT_MAX_WIDTH = "800px";

/**
 * Minimum right margin reserved for sidenotes and margin annotations.
 * Applied as: `max(224px, calc((100% - 800px) / 2))`.
 * 224 px is the minimum that fits a 240 px sidenote widget (SIDENOTE_WIDTH)
 * with a small gap. On wide viewports the natural centering formula takes over
 * and the margin expands proportionally.
 */
export const MARGIN_RIGHT_CALC = "224px";

/**
 * Horizontal offset of sidenote widgets from the right edge of the viewport.
 * Negative value pulls the widget into the right margin. -280 px places the
 * 240 px widget flush against the margin boundary with ~40 px breathing room.
 */
export const SIDENOTE_OFFSET = "-280px";

/**
 * Width of a sidenote margin widget.
 * 240 px fits approximately 30–35 characters per line in the footnote font
 * size — readable without wrapping excessively for short notes.
 */
export const SIDENOTE_WIDTH = "240px";

/**
 * Maximum height for image widgets in the rendered editor.
 * 400 px caps tall portrait images so they do not dominate the viewport and
 * push surrounding text too far down while reading.
 */
export const IMAGE_MAX_HEIGHT = "400px";

/**
 * Fixed height for embed iframe widgets (non-YouTube).
 * 350 px accommodates most code embeds (CodePen, JSFiddle, Replit) without
 * scrollbars, while remaining small enough to see surrounding content.
 */
export const EMBED_IFRAME_HEIGHT = "350px";

/**
 * Minimum height for Gist embed iframes before content loads.
 * 200 px reserves space to prevent layout shift when the Gist JS injects its
 * content asynchronously after the initial render.
 */
export const GIST_MIN_HEIGHT = "200px";

/**
 * Padding-bottom percentage for a 16:9 aspect-ratio iframe container.
 * 9/16 = 0.5625 = 56.25 %. Used with `position: relative` / `padding-bottom`
 * trick so YouTube iframes scale responsively while preserving aspect ratio.
 */
export const ASPECT_RATIO_16_9 = "56.25%";

/**
 * Vertical padding (top and bottom) for the editor content area.
 * 24 px gives the first and last lines breathing room without wasting
 * significant vertical space on smaller screens.
 */
export const CONTENT_PADDING_Y = "24px";

/**
 * Horizontal padding (left and right) for the editor content area.
 * 48 px keeps text away from the window/sidebar edge and aligns with the
 * left-margin calculation used for headings and block labels.
 */
export const CONTENT_PADDING_X = "48px";

/**
 * Right margin gap on the sidenote number label.
 * 3 px provides a tight but visible separation between the superscript number
 * and the start of the sidenote text.
 */
export const SIDENOTE_NUMBER_MARGIN_RIGHT = "3px";

/**
 * Right offset of the include-label relative to its anchor element.
 * -44 px places the rotated filename label in the right gutter, just outside
 * the content column boundary, so it does not overlap the document text.
 */
export const INCLUDE_LABEL_RIGHT = "-44px";

/**
 * Top offset of the include-label within its anchor element.
 * 2 px nudges the label downward to optically align with the first line of the
 * included block rather than floating above it.
 */
export const INCLUDE_LABEL_TOP = "2px";

/**
 * Font size for the include-label rotated filename.
 * 10 px is small enough to fit a moderately long filename in the narrow right
 * gutter when rotated 90°, while remaining legible at normal display densities.
 */
export const INCLUDE_LABEL_FONT_SIZE = "10px";

/**
 * Letter-spacing for the include-label rotated filename.
 * 0.3 px adds slight tracking to improve readability of the small, rotated
 * uppercase-style label text.
 */
export const INCLUDE_LABEL_LETTER_SPACING = "0.3px";
