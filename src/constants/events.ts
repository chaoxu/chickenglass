/**
 * Custom DOM event name constants used across the Coflat app.
 *
 * All event names follow the `cf:` namespace prefix so they are
 * distinguishable from native browser events and third-party libraries.
 */

/** Dispatched on `window` to trigger a data refresh in the perf debug panel. */
export const PERF_PANEL_REFRESH_EVENT = "cf:perf-panel-refresh";

export type HeadingFormatLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface FormatEventDetailMap {
  bold: { type: "bold" };
  italic: { type: "italic" };
  code: { type: "code" };
  strikethrough: { type: "strikethrough" };
  highlight: { type: "highlight" };
  link: { type: "link" };
  heading: { type: "heading"; level: HeadingFormatLevel };
}

export type FormatEventType = keyof FormatEventDetailMap;
export type FormatEventDetail = FormatEventDetailMap[FormatEventType];
export type SimpleFormatEventType = Exclude<FormatEventType, "heading">;

export const NAVIGATE_SOURCE_POSITION_EVENT = "cf:navigate-source-position";

export interface NavigateSourcePositionEventDetail {
  pos: number;
}

declare global {
  interface DocumentEventMap {
    "cf:navigate-source-position": CustomEvent<NavigateSourcePositionEventDetail>;
  }
}

export function dispatchNavigateSourcePositionEvent(pos: number): void {
  document.dispatchEvent(new CustomEvent<NavigateSourcePositionEventDetail>(
    NAVIGATE_SOURCE_POSITION_EVENT,
    {
      detail: { pos },
    },
  ));
}

/**
 * Dispatched on the editor host when the editor mode changes.
 * Detail: the new `EditorMode` string ("lexical" | "source").
 */
export const MODE_CHANGE_EVENT = "cf:mode-change";

/**
 * Dispatched on `view.dom` (bubbles) when the user navigates into an include
 * region and triggers a jump to the source file.
 * Detail: the file path string.
 */
export const OPEN_FILE_EVENT = "cf:open-file";
