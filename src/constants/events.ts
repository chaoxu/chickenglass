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
 * Detail shape is keyed by the format action type.
 */
export const FORMAT_EVENT = "cf:format";

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
    "cf:format": CustomEvent<FormatEventDetail>;
    "cf:navigate-source-position": CustomEvent<NavigateSourcePositionEventDetail>;
  }
}

/** Dispatch a formatting event to the document for CM6 to handle. */
export function dispatchFormatEvent(type: SimpleFormatEventType): void;
export function dispatchFormatEvent(
  type: "heading",
  detail: Omit<FormatEventDetailMap["heading"], "type">,
): void;
export function dispatchFormatEvent(
  type: FormatEventType,
  detail?: Omit<FormatEventDetailMap["heading"], "type">,
): void {
  const eventDetail: FormatEventDetail = type === "heading"
    ? (() => {
      if (!detail) {
        throw new Error("[format-event] heading detail requires a level");
      }
      return { type, level: detail.level };
    })()
    : { type };
  document.dispatchEvent(new CustomEvent<FormatEventDetail>(FORMAT_EVENT, { detail: eventDetail }));
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
 * Dispatched on `view.dom` (bubbles) when the editor mode cycles.
 * Detail: the new `EditorMode` string ("rich" | "source" | "read").
 */
export const MODE_CHANGE_EVENT = "cf:mode-change";
