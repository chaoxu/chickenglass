export const WIDGET_KEYBOARD_ENTRY_EVENT = "coflat-widget-keyboard-entry";

export type WidgetKeyboardEntryDirection = "up" | "down";

export interface WidgetKeyboardEntryDetail {
  readonly direction: WidgetKeyboardEntryDirection;
  readonly sourceFrom: number;
  readonly sourceTo: number;
}

export function dispatchWidgetKeyboardEntry(
  target: HTMLElement,
  detail: WidgetKeyboardEntryDetail,
): boolean {
  const event = new CustomEvent<WidgetKeyboardEntryDetail>(
    WIDGET_KEYBOARD_ENTRY_EVENT,
    {
      bubbles: true,
      cancelable: true,
      detail,
    },
  );
  target.dispatchEvent(event);
  return event.defaultPrevented;
}
