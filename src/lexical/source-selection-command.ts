import { createCommand } from "lexical";

export interface SourceSelectionCommandPayload {
  readonly anchor: number;
  readonly focus: number;
}

export const SET_SOURCE_SELECTION_COMMAND = createCommand<number | SourceSelectionCommandPayload>(
  "COFLAT_SET_SOURCE_SELECTION_COMMAND",
);
