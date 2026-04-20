import type { NodeKey } from "lexical";

interface CursorRevealLifecycleBase {
  readonly userIntent: boolean;
}

export type CursorRevealMachineState<Session> =
  | (CursorRevealLifecycleBase & {
      readonly lastClosedKey: NodeKey | null;
      readonly tag: "idle";
    })
  | (CursorRevealLifecycleBase & {
      readonly session: Session;
      readonly suppressArrowUntil: number;
      readonly tag: "opening";
    })
  | (CursorRevealLifecycleBase & {
      readonly session: Session;
      readonly tag: "editing";
    })
  | (CursorRevealLifecycleBase & {
      readonly session: Session;
      readonly tag: "committing";
    })
  | (CursorRevealLifecycleBase & {
      readonly lastClosedKey: NodeKey | null;
      readonly tag: "closing";
    });

export type CursorRevealOpenPhase = Extract<CursorRevealMachineState<unknown>["tag"], "editing" | "opening">;

export function createCursorRevealIdle<Session>(
  lastClosedKey: NodeKey | null = null,
  userIntent = false,
): CursorRevealMachineState<Session> {
  return {
    lastClosedKey,
    tag: "idle",
    userIntent,
  };
}

export function openCursorReveal<Session>(
  session: Session,
  phase: CursorRevealOpenPhase,
  options: {
    readonly suppressArrowUntil?: number;
    readonly userIntent?: boolean;
  } = {},
): CursorRevealMachineState<Session> {
  return phase === "opening"
    ? {
        session,
        suppressArrowUntil: options.suppressArrowUntil ?? 0,
        tag: "opening",
        userIntent: options.userIntent ?? false,
      }
    : {
        session,
        tag: "editing",
        userIntent: options.userIntent ?? false,
      };
}

export function activateCursorReveal<Session>(
  state: CursorRevealMachineState<Session>,
): CursorRevealMachineState<Session> {
  return state.tag === "opening"
    ? {
        session: state.session,
        tag: "editing",
        userIntent: state.userIntent,
      }
    : state;
}

export function beginCursorRevealCommit<Session>(
  state: CursorRevealMachineState<Session>,
): CursorRevealMachineState<Session> {
  const session = getCursorRevealSession(state);
  return session
    ? {
        session,
        tag: "committing",
        userIntent: state.userIntent,
      }
    : state;
}

export function beginCursorRevealClose<Session>(
  state: CursorRevealMachineState<Session>,
  lastClosedKey: NodeKey | null = null,
): CursorRevealMachineState<Session> {
  return {
    lastClosedKey,
    tag: "closing",
    userIntent: state.userIntent,
  };
}

export function finishCursorRevealClose<Session>(
  state: CursorRevealMachineState<Session>,
): CursorRevealMachineState<Session> {
  return state.tag === "closing"
    ? createCursorRevealIdle(state.lastClosedKey, state.userIntent)
    : state;
}

export function closeCursorReveal<Session>(
  state: CursorRevealMachineState<Session>,
  lastClosedKey: NodeKey | null = null,
): CursorRevealMachineState<Session> {
  return finishCursorRevealClose(beginCursorRevealClose(state, lastClosedKey));
}

export function clearClosedCursorReveal<Session>(
  state: CursorRevealMachineState<Session>,
): CursorRevealMachineState<Session> {
  return state.tag === "idle" && state.lastClosedKey !== null
    ? createCursorRevealIdle(null, state.userIntent)
    : state;
}

export function getCursorRevealSession<Session>(
  state: CursorRevealMachineState<Session>,
): Session | null {
  return state.tag === "idle" || state.tag === "closing" ? null : state.session;
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

export function markCursorRevealUserIntent<Session>(
  state: CursorRevealMachineState<Session>,
): CursorRevealMachineState<Session> {
  return state.userIntent ? state : setCursorRevealUserIntent(state, true);
}

export function clearCursorRevealUserIntent<Session>(
  state: CursorRevealMachineState<Session>,
): CursorRevealMachineState<Session> {
  return state.userIntent ? setCursorRevealUserIntent(state, false) : state;
}

export function consumeCursorRevealUserIntent<Session>(
  state: CursorRevealMachineState<Session>,
  required: boolean,
): {
  readonly allowed: boolean;
  readonly state: CursorRevealMachineState<Session>;
} {
  if (!required) {
    return { allowed: true, state: clearCursorRevealUserIntent(state) };
  }
  if (!state.userIntent) {
    return { allowed: false, state };
  }
  return {
    allowed: true,
    state: setCursorRevealUserIntent(state, false),
  };
}

function setCursorRevealUserIntent<Session>(
  state: CursorRevealMachineState<Session>,
  userIntent: boolean,
): CursorRevealMachineState<Session> {
  switch (state.tag) {
    case "idle":
      return { ...state, userIntent };
    case "opening":
      return { ...state, userIntent };
    case "editing":
      return { ...state, userIntent };
    case "committing":
      return { ...state, userIntent };
    case "closing":
      return { ...state, userIntent };
  }
}
