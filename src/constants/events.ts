/**
 * Custom DOM event name constants used across the Coflat app.
 *
 * All event names follow the `cf:` namespace prefix so they are
 * distinguishable from native browser events and third-party libraries.
 */

/** Dispatched on `window` to toggle the performance debug panel open/closed. */
export const PERF_PANEL_TOGGLE_EVENT = "cf:perf-panel-toggle";

/** Dispatched on `window` to trigger a data refresh in the perf debug panel. */
export const PERF_PANEL_REFRESH_EVENT = "cf:perf-panel-refresh";

/**
 * Dispatched on `document` when an inline-formatting command (bold, italic,
 * etc.) is triggered from the menu bar.
 * Detail shape: `{ type: string; [extra]: unknown }`.
 */
export const FORMAT_EVENT = "cf:format";

/**
 * Dispatched on `view.dom` (bubbles) when the editor mode cycles.
 * Detail: the new `EditorMode` string ("rich" | "source" | "read").
 */
export const MODE_CHANGE_EVENT = "cf:mode-change";

/**
 * Dispatched on `view.dom` (bubbles) when the user navigates into an include
 * region and triggers a jump to the source file.
 * Detail: the file path string.
 */
export const OPEN_FILE_EVENT = "cf:open-file";
