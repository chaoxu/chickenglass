import { createCommand } from "lexical";

export const SET_SOURCE_SELECTION_COMMAND = createCommand<number>(
  "COFLAT_SET_SOURCE_SELECTION_COMMAND",
);
