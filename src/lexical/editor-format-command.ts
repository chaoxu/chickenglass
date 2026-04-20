import { createCommand } from "lexical";

import type { FormatEventDetail } from "../constants/events";

export const FORMAT_MARKDOWN_COMMAND = createCommand<FormatEventDetail>("FORMAT_MARKDOWN_COMMAND");
