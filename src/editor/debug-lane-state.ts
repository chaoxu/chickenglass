export interface DebugLaneWindowState {
  readonly available: boolean;
  readonly enabled: boolean;
}

const DEBUG_LANE_CHANGE_EVENT = "cf:debug-lane-change";

function defaultState(): DebugLaneWindowState {
  return {
    available: false,
    enabled: false,
  };
}

export function readWindowDebugLaneState(): DebugLaneWindowState {
  if (typeof window === "undefined") {
    return defaultState();
  }

  const debug = window.__cmDebug;
  return {
    available: Boolean(debug),
    enabled: Boolean(debug?.debugLaneEnabled?.()),
  };
}

export function subscribeWindowDebugLaneState(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(DEBUG_LANE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(DEBUG_LANE_CHANGE_EVENT, onStoreChange);
  };
}

export function emitWindowDebugLaneStateChange(): DebugLaneWindowState {
  const nextState = readWindowDebugLaneState();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEBUG_LANE_CHANGE_EVENT, { detail: nextState }));
  }
  return nextState;
}

export function toggleWindowDebugLane(): DebugLaneWindowState {
  window.__cmDebug?.toggleDebugLane?.();
  return emitWindowDebugLaneStateChange();
}
