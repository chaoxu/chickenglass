import type { NodeKey } from "lexical";

export type CursorRevealMachineState<Session> =
  | {
      readonly lastClosedKey: NodeKey | null;
      readonly tag: "idle";
    }
  | {
      readonly session: Session;
      readonly suppressArrowUntil: number;
      readonly tag: "opening";
    }
  | {
      readonly session: Session;
      readonly tag: "editing";
    };

export type CursorRevealOpenPhase = Extract<CursorRevealMachineState<unknown>["tag"], "editing" | "opening">;

export function createCursorRevealIdle<Session>(
  lastClosedKey: NodeKey | null = null,
): CursorRevealMachineState<Session> {
  return {
    lastClosedKey,
    tag: "idle",
  };
}

export function openCursorReveal<Session>(
  session: Session,
  phase: CursorRevealOpenPhase,
  options: { readonly suppressArrowUntil?: number } = {},
): CursorRevealMachineState<Session> {
  return phase === "opening"
    ? {
        session,
        suppressArrowUntil: options.suppressArrowUntil ?? 0,
        tag: "opening",
      }
    : {
        session,
        tag: "editing",
      };
}

export function activateCursorReveal<Session>(
  state: CursorRevealMachineState<Session>,
): CursorRevealMachineState<Session> {
  return state.tag === "opening"
    ? {
        session: state.session,
        tag: "editing",
      }
    : state;
}

export function closeCursorReveal<Session>(
  _state: CursorRevealMachineState<Session>,
  lastClosedKey: NodeKey | null = null,
): CursorRevealMachineState<Session> {
  return createCursorRevealIdle(lastClosedKey);
}

export function clearClosedCursorReveal<Session>(
  state: CursorRevealMachineState<Session>,
): CursorRevealMachineState<Session> {
  return state.tag === "idle" && state.lastClosedKey !== null
    ? createCursorRevealIdle()
    : state;
}

export function getCursorRevealSession<Session>(
  state: CursorRevealMachineState<Session>,
): Session | null {
  return state.tag === "idle" ? null : state.session;
}

export function isCursorRevealOpening<Session>(
  state: CursorRevealMachineState<Session>,
): state is Extract<CursorRevealMachineState<Session>, { readonly tag: "opening" }> {
  return state.tag === "opening";
}

export function shouldSuppressCursorRevealOpen<Session>(
  state: CursorRevealMachineState<Session>,
  nodeKey: NodeKey,
): boolean {
  return state.tag === "idle" && state.lastClosedKey === nodeKey;
}
