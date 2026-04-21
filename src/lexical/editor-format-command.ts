import type { LexicalCommand } from "lexical";

import type { FormatEventDetail } from "../constants/events";

export const FORMAT_MARKDOWN_COMMAND: LexicalCommand<FormatEventDetail> = {
  type: "FORMAT_MARKDOWN_COMMAND",
};
