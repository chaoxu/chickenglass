import {
  WIDGET_KEYBOARD_ENTRY_EVENT,
  type WidgetKeyboardEntryDetail,
} from "../state/widget-keyboard-entry";

const tableKeyboardEntryHandlers = new WeakMap<HTMLElement, EventListener>();

export function consumeTableKeyboardEvent(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export interface TableKeyboardEntryController {
  enterPreviewCellFromKeyboard(
    container: HTMLElement,
    direction: "up" | "down",
  ): boolean;
}

export function bindTableKeyboardEntry(
  container: HTMLElement,
  controller: TableKeyboardEntryController,
): void {
  const previousHandler = tableKeyboardEntryHandlers.get(container);
  if (previousHandler) {
    container.removeEventListener(WIDGET_KEYBOARD_ENTRY_EVENT, previousHandler);
  }

  const handler = (event: Event): void => {
    const customEvent = event as CustomEvent<WidgetKeyboardEntryDetail>;
    const direction = customEvent.detail?.direction;
    if (direction !== "up" && direction !== "down") return;
    if (!controller.enterPreviewCellFromKeyboard(container, direction)) return;

    event.preventDefault();
    event.stopPropagation();
  };

  container.addEventListener(WIDGET_KEYBOARD_ENTRY_EVENT, handler);
  tableKeyboardEntryHandlers.set(container, handler);
}
