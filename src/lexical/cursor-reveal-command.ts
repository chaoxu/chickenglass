import { createCommand, type NodeKey } from "lexical";

export interface CursorRevealOpenRequest {
  readonly adapterId: string;
  readonly caretOffset: number;
  readonly entry: "keyboard-boundary" | "pointer" | "selection";
  readonly nodeKey: NodeKey;
  readonly source: string;
}

export const OPEN_CURSOR_REVEAL_COMMAND = createCommand<CursorRevealOpenRequest>(
  "OPEN_CURSOR_REVEAL_COMMAND",
);
