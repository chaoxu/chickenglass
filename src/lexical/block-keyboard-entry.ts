export const BLOCK_KEYBOARD_ACTIVATION_ATTRIBUTE =
  "data-coflat-block-keyboard-activation";

export const BLOCK_KEYBOARD_ACTIVATION_SELECTOR =
  "[data-coflat-block-keyboard-activation='true']";

export const BLOCK_KEYBOARD_ENTRY_ATTRIBUTE =
  "data-coflat-block-keyboard-entry";

export const BLOCK_KEYBOARD_PRIMARY_ENTRY_SELECTOR =
  "[data-coflat-block-keyboard-entry='primary']";

export type BlockKeyboardEntryPriority = "primary";

export function blockKeyboardActivationProps(
  enabled: boolean,
): Record<string, string> {
  return enabled
    ? { [BLOCK_KEYBOARD_ACTIVATION_ATTRIBUTE]: "true" }
    : {};
}

export function blockKeyboardEntryProps(
  priority?: BlockKeyboardEntryPriority,
): Record<string, string> {
  return priority
    ? { [BLOCK_KEYBOARD_ENTRY_ATTRIBUTE]: priority }
    : {};
}

export function syncBlockKeyboardEntryAttribute(
  element: HTMLElement,
  priority?: BlockKeyboardEntryPriority,
): void {
  if (priority) {
    element.setAttribute(BLOCK_KEYBOARD_ENTRY_ATTRIBUTE, priority);
    return;
  }
  element.removeAttribute(BLOCK_KEYBOARD_ENTRY_ATTRIBUTE);
}

function visibleKeyboardTargets(
  elements: readonly HTMLElement[],
  options: { readonly includeHidden?: boolean } = {},
): HTMLElement[] {
  return options.includeHidden
    ? [...elements]
    : elements.filter((element) => !element.classList.contains("cf-lexical-editor--hidden"));
}

export function queryBlockKeyboardActivationTarget(
  root: HTMLElement,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(BLOCK_KEYBOARD_ACTIVATION_SELECTOR);
}

export function queryBlockKeyboardEditableTargets(
  root: HTMLElement,
  options: { readonly includeHidden?: boolean } = {},
): HTMLElement[] {
  const primaryEntries = [...root.querySelectorAll<HTMLElement>(
    `${BLOCK_KEYBOARD_PRIMARY_ENTRY_SELECTOR} [contenteditable='true']`,
  )];
  if (primaryEntries.length > 0) {
    return visibleKeyboardTargets(primaryEntries, options);
  }

  return visibleKeyboardTargets(
    [...root.querySelectorAll<HTMLElement>("[contenteditable='true']")],
    options,
  );
}

export function queryBlockKeyboardFocusableTargets(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    "button, [role='button'], a[href], [tabindex]:not([tabindex='-1'])",
  )];
}
