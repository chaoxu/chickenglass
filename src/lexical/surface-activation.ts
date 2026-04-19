import type {
  KeyboardEvent,
  SyntheticEvent,
} from "react";

import {
  blockKeyboardActivationProps,
  queryBlockKeyboardActivationTarget,
  queryBlockKeyboardEditableTargets,
  queryBlockKeyboardFocusableTargets,
} from "./block-keyboard-entry";
import { requestRegisteredSurfaceFocus } from "./editor-focus-plugin";

export type SurfaceActivationDirection = "backward" | "forward";

export interface SurfaceActivationPropsOptions {
  readonly keyboardActivation?: boolean;
  readonly onBeforeActivate?: (element: HTMLElement, event: SyntheticEvent) => void;
  readonly stopPropagation?: boolean;
}

export function surfaceActivationProps(
  active: boolean,
  onActivate: () => void,
  options?: SurfaceActivationPropsOptions,
): Record<string, unknown> {
  if (!active) return {};

  const stop = options?.stopPropagation;
  const onBeforeActivate = options?.onBeforeActivate;
  return {
    onClick: (event: SyntheticEvent) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLElement) {
        onBeforeActivate?.(event.currentTarget, event);
      }
      if (stop) {
        event.stopPropagation();
      }
      onActivate();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) {
          onBeforeActivate?.(event.currentTarget, event);
        }
        if (stop) {
          event.stopPropagation();
        }
        onActivate();
      }
    },
    ...blockKeyboardActivationProps(Boolean(options?.keyboardActivation)),
    role: "button",
    tabIndex: 0,
  };
}

export function requestNestedEditorActivation(
  editable: HTMLElement,
  direction: SurfaceActivationDirection,
): boolean {
  return requestRegisteredSurfaceFocus(
    editable,
    direction === "forward" ? "start" : "end",
  );
}

export function focusSurfaceTarget(
  target: HTMLElement,
  direction: SurfaceActivationDirection,
): boolean {
  const editableTargets = queryBlockKeyboardEditableTargets(target);

  const editable = direction === "forward"
    ? editableTargets[0]
    : editableTargets[editableTargets.length - 1];
  if (editable && requestNestedEditorActivation(editable, direction)) {
    return true;
  }

  const focusableTargets = queryBlockKeyboardFocusableTargets(target);
  const focusable = direction === "forward"
    ? focusableTargets[0]
    : focusableTargets[focusableTargets.length - 1];
  if (focusable) {
    focusable.focus();
    return true;
  }

  return false;
}

export function activateDomSurface(target: HTMLElement): boolean {
  target.focus();
  target.click();
  return true;
}

export function enterBlockSurfaceTarget(
  target: HTMLElement,
  direction: SurfaceActivationDirection,
): boolean {
  const activationTarget = queryBlockKeyboardActivationTarget(target);
  if (activationTarget) {
    return activateDomSurface(activationTarget);
  }

  requestAnimationFrame(() => {
    focusSurfaceTarget(target, direction);
  });
  return focusSurfaceTarget(target, direction);
}
