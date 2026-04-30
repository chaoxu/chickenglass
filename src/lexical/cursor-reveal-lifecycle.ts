import type { NodeKey } from "lexical";
import {
  beginCursorRevealClose,
  beginCursorRevealCommit,
  type CursorRevealMachineState,
  finishCursorRevealClose,
} from "./cursor-reveal-machine";

export interface CursorRevealLifecycleRef<Session> {
  current: CursorRevealMachineState<Session>;
}

export function beginRevealCommit<Session>(
  lifecycleRef: CursorRevealLifecycleRef<Session>,
): void {
  lifecycleRef.current = beginCursorRevealCommit(lifecycleRef.current);
}

export function finishRevealClose<Session>(
  lifecycleRef: CursorRevealLifecycleRef<Session>,
  lastClosedKey: NodeKey | null = null,
): void {
  lifecycleRef.current = finishCursorRevealClose(
    beginCursorRevealClose(lifecycleRef.current, lastClosedKey),
  );
}
