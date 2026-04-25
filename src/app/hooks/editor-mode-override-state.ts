import type { EditorMode } from "../../editor-display-mode";

export interface ModeOverrideTarget {
  path: string;
  mode: EditorMode;
}

export type ModeOverrideLifecycle =
  | { status: "idle" }
  | { status: "pending"; requestId: number; target: ModeOverrideTarget }
  | { status: "committed"; target: ModeOverrideTarget };

export interface EditorModeOverrideState {
  lifecycle: ModeOverrideLifecycle;
  overrides: Readonly<Record<string, EditorMode>>;
}

export type EditorModeOverrideTransition =
  | { type: "begin"; requestId: number; target: ModeOverrideTarget }
  | { type: "commit"; requestId?: number; target: ModeOverrideTarget }
  | { type: "clear-pending"; requestId: number };

export const initialEditorModeOverrideState: EditorModeOverrideState = {
  lifecycle: { status: "idle" },
  overrides: {},
};

export function transitionEditorModeOverride(
  state: EditorModeOverrideState,
  transition: EditorModeOverrideTransition,
): EditorModeOverrideState {
  if (transition.type === "begin") {
    return {
      ...state,
      lifecycle: {
        status: "pending",
        requestId: transition.requestId,
        target: transition.target,
      },
    };
  }

  if (transition.type === "clear-pending") {
    if (
      state.lifecycle.status !== "pending"
      || state.lifecycle.requestId !== transition.requestId
    ) {
      return state;
    }
    return {
      ...state,
      lifecycle: { status: "idle" },
    };
  }

  if (
    transition.requestId !== undefined
    && (
      state.lifecycle.status !== "pending"
      || state.lifecycle.requestId !== transition.requestId
    )
  ) {
    return state;
  }

  return {
    lifecycle: {
      status: "committed",
      target: transition.target,
    },
    overrides: {
      ...state.overrides,
      [transition.target.path]: transition.target.mode,
    },
  };
}

export function getPendingModeOverride(
  state: EditorModeOverrideState,
  path: string | null,
): EditorMode | undefined {
  if (
    state.lifecycle.status === "pending"
    && state.lifecycle.target.path === path
  ) {
    return state.lifecycle.target.mode;
  }
  return undefined;
}

export function getCommittedModeOverride(
  state: EditorModeOverrideState,
  path: string | null,
): EditorMode | undefined {
  return path ? state.overrides[path] : undefined;
}
